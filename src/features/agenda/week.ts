/**
 * "Which days does this week cover, and what can be offered on each" — the
 * calendar half of the availability table.
 *
 * Split from slots.ts the same way the bot splits search.ts from its packer: this
 * owns which day to look at, the packer owns which times on that day keep the
 * schedule contiguous. Both halves are pure over injected Gestek reads, so the
 * whole rule is testable without touching the network.
 *
 * Gestek is no help with the calendar — it offered the full 12:00-18:30 grid for a
 * Sunday — so weekday and closed-date filtering is entirely ours.
 */

import type { GestekDayBooking } from "./parse";
import type { BookingRules } from "./rules";
import { packSlots, toBusyIntervals } from "./slots";
import type { AgendaBooking, AgendaDay } from "./types";
import { addDaysISO, localToUtcIso, todayLocalISO, weekdayOfISO } from "./time";

/** The two Gestek reads a day needs, injectable so this is testable offline. */
export interface AgendaDeps {
  availableSlots(dateISO: string): Promise<string[]>;
  dayBookings(dateISO: string): Promise<GestekDayBooking[]>;
}

/** The Monday on or before `dateISO`. Weeks run Monday-first, as the clinic reads them. */
export function mondayOfWeek(dateISO: string): string {
  const weekday = weekdayOfISO(dateISO);
  // Sunday (0) belongs to the week that just ended, not the one starting tomorrow.
  return addDaysISO(dateISO, -((weekday + 6) % 7));
}

/** Monday of the week `offset` weeks from the current one. 0 = this week. */
export function weekStartForOffset(offset: number, now: Date = new Date()): string {
  return addDaysISO(mondayOfWeek(todayLocalISO(now)), offset * 7);
}

/**
 * One day, packed and filtered, with the reason when it comes back empty.
 *
 * Mirrors the bot's `searchDay`, minus the parts that only make sense inside a
 * conversation (period windows, already-refused times). The lead-time filter is
 * kept: a time the bot would never offer is not a time the caller should promise
 * either, and it is what stops this morning's already-passed slots showing up.
 */
export async function buildAgendaDay(
  deps: AgendaDeps,
  rules: BookingRules,
  dateISO: string,
  now: Date = new Date(),
): Promise<AgendaDay> {
  const weekday = weekdayOfISO(dateISO);
  const base = { dateISO, weekday };
  // The clinic's own decisions are attached later, outside the Gestek cache
  // (data.ts), so a save repaints the grid without buying ten live Gestek reads.
  const empty = (outcome: AgendaDay["outcome"], bookings: AgendaBooking[] = []): AgendaDay => ({
    ...base,
    outcome,
    slots: [],
    bookings,
    blockedStarts: [],
    openedStarts: [],
    bookedCount: outcome === "error" || outcome === "past" || outcome === "closed" ? null : bookings.length,
  });

  if (dateISO < todayLocalISO(now)) return empty("past");
  if (!rules.workdays.includes(weekday)) return empty("closed");
  if (rules.closedDates.includes(dateISO)) return empty("closed");

  let freeSlots: string[];
  let bookings: GestekDayBooking[];
  try {
    [freeSlots, bookings] = await Promise.all([deps.availableSlots(dateISO), deps.dayBookings(dateISO)]);
  } catch (err) {
    // One transient 500 must not turn the whole week into "no availability".
    console.error(`[agenda:week] ${dateISO} skipped:`, err instanceof Error ? err.message : err);
    return empty("error");
  }

  // The grid paints occupancy, so a booking's extent travels with it — the same
  // busy intervals the packer works from, kept instead of thrown away.
  const busy = toBusyIntervals(bookings, rules.defaultBookingDurationMin);
  const occupied: AgendaBooking[] = busy
    .map((b) => ({ startMin: b.start, endMin: b.end }))
    .sort((a, b) => a.startMin - b.startMin);

  const packed = packSlots({
    freeSlots,
    bookings: busy,
    durationMin: rules.durationMin,
    bufferMin: rules.bufferMin,
    dayOpenMin: rules.dayOpenMin,
    dayCloseMin: rules.dayCloseMin,
    maxGapMin: rules.maxGapMin,
  });
  if (packed.length === 0) return empty("full", occupied);

  const notBefore = now.getTime() + rules.leadTimeMin * 60_000;
  const bookable = packed.filter((slot) => Date.parse(localToUtcIso(dateISO, slot.startMin)) >= notBefore);
  if (bookable.length === 0) return empty("too-late", occupied);

  // The packer ranks by how little time a slot strands, which is the right order
  // for picking two to offer over WhatsApp. A table is read down the day, so it is
  // re-sorted by the clock — the set of times is identical either way.
  return {
    ...base,
    outcome: "ok",
    slots: [...bookable].sort((a, b) => a.startMin - b.startMin),
    bookings: occupied,
    bookedCount: bookings.length,
    blockedStarts: [],
    openedStarts: [],
  };
}

/**
 * The workdays of the week starting `weekStartISO`, each with its offerable times.
 *
 * Days are walked one at a time rather than in parallel on purpose: the Gestek
 * token is shared with the nightly sync and rate-limits per token, so ten
 * simultaneous reads buy a 429 and a backoff that is slower than just asking in
 * order. Non-working days never reach the network at all.
 */
export async function buildAgendaWeek(
  deps: AgendaDeps,
  rules: BookingRules,
  weekStartISO: string,
  now: Date = new Date(),
): Promise<AgendaDay[]> {
  const days: AgendaDay[] = [];
  for (let i = 0; i < 7; i++) {
    const dateISO = addDaysISO(weekStartISO, i);
    // The weekend is not a column the clinic ever wants to look at; a one-off
    // closure inside the week still is, so it stays and says "Fechado".
    if (!rules.workdays.includes(weekdayOfISO(dateISO))) continue;
    days.push(await buildAgendaDay(deps, rules, dateISO, now));
  }
  return days;
}
