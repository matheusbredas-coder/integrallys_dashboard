import "server-only";
import { unstable_cache } from "next/cache";
import { getAgendaOverrides } from "./blocks";
import { availableSlots, dayBookings } from "./gestek";
import { BOOKING_RULES, MAX_WEEK_OFFSET } from "./rules";
import type { AgendaWeek } from "./types";
import { buildAgendaWeek, weekStartForOffset } from "./week";
import { CLINIC_UTC_OFFSET_MIN } from "./time";

function clinicClock(now: Date): string {
  const shifted = new Date(now.getTime() + CLINIC_UTC_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(11, 16);
}

async function fetchWeek(offset: number): Promise<AgendaWeek> {
  const now = new Date();
  const weekStartISO = weekStartForOffset(offset, now);
  const days = await buildAgendaWeek({ availableSlots, dayBookings }, BOOKING_RULES, weekStartISO, now);
  return { weekStartISO, offset, days, fetchedAt: clinicClock(now) };
}

/**
 * One week of offerable times, cached 60s under the "agenda" tag.
 *
 * Gestek ONLY. What the clinic decided by hand is attached afterwards by
 * `getAgendaWeekWithBlocks`, which is what the page actually calls.
 *
 * Cached because the uncached page costs up to ten live Gestek calls on a token
 * shared with the nightly sync, and the caller reloads /marketing constantly. Sixty
 * seconds is short enough that a booking made in Gestek shows up on her next
 * refresh, and the "Atualizar" button clears it immediately when it matters.
 *
 * The offset is part of the cache key, so paging to next week is its own entry.
 */
function getGestekWeek(offset: number): Promise<AgendaWeek> {
  const clamped = Math.max(-MAX_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, Math.trunc(offset) || 0));
  return unstable_cache(() => fetchWeek(clamped), ["agenda-week", String(clamped)], {
    revalidate: 60,
    tags: ["agenda"],
  })();
}

/**
 * The week the page draws: Gestek's diary with the clinic's own decisions over it.
 *
 * The two reads are deliberately layered rather than merged into one cached call.
 * Gestek is slow, rate-limited and shared with the nightly sync, so it stays
 * behind the 60-second cache; a saved block has to show up at once, so it is read
 * fresh on every render. One cheap indexed query buys that.
 */
export async function getAgendaWeekWithBlocks(offset: number): Promise<AgendaWeek> {
  const week = await getGestekWeek(offset);
  if (week.days.length === 0) return week;

  const overrides = await getAgendaOverrides(
    week.days[0]!.dateISO,
    week.days[week.days.length - 1]!.dateISO,
  );
  return {
    ...week,
    days: week.days.map((day) => ({
      ...day,
      blockedStarts: overrides[day.dateISO]?.blocked ?? [],
      openedStarts: overrides[day.dateISO]?.opened ?? [],
    })),
  };
}
