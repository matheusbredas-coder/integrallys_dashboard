/**
 * The half-hour ladder the week's agenda is drawn on.
 *
 * Pure, so the rule that decides "is this half hour taken?" can be pinned in
 * tests without a Gestek call or a render. Three things it exists to get right:
 *
 *   - A booking occupies every half hour it TOUCHES, not just the one it starts
 *     in. An hour-long appointment at 12:00 must paint 12:00 and 12:30, or the
 *     caller reads 12:30 as free and books over it.
 *   - Real appointments do not respect the grid. Staff book at 11:45, and a
 *     procedure can run past the last offerable time, so the ladder stretches to
 *     cover whatever the week actually holds instead of clipping it out of sight.
 *   - A half hour blocked BY HAND (migration 029) and one taken by a Gestek
 *     appointment are both unavailable, and both draw the same "x" — but they are
 *     not the same cell. Only the hand-made one can be taken back off, so the two
 *     stay distinguishable here rather than being flattened into one "busy".
 *   - The clinic can also go the other way and hand a booked half hour back out.
 *     That cell reads as available, but there is still an appointment underneath
 *     it, so it is its own state rather than plain "idle" — the difference is the
 *     whole warning.
 */

import { minutesToHhmm } from "./slots";
import type { AgendaBooking, AgendaDay } from "./types";

export const ROW_MIN = 30;

/** What one day's column says at one row of the ladder. */
export type GridCell =
  /** A real Gestek appointment. `first` is the row it starts in. Not removable here. */
  | { kind: "busy"; first: boolean; startMin: number; endMin: number }
  /** Closed by hand from this grid. Removable by clicking it again. */
  | { kind: "blocked" }
  /** Booked in Gestek, but handed back out by the clinic. Offerable, with a patient under it. */
  | { kind: "opened"; startMin: number; endMin: number }
  /** Nothing on the diary for that half hour. */
  | { kind: "idle" };

/** The layers a day's column is drawn from: Gestek, then what the clinic said. */
type GridDay = Pick<AgendaDay, "bookings"> &
  Partial<Pick<AgendaDay, "blockedStarts" | "openedStarts">>;

const floorRow = (min: number) => Math.floor(min / ROW_MIN) * ROW_MIN;
const ceilRow = (min: number) => Math.ceil(min / ROW_MIN) * ROW_MIN;

/**
 * The rows to draw, in clock order — a fixed ladder, not "the times that happen".
 *
 * Starts from the clinic's opening and runs to its last bookable time, then
 * widens for anything booked outside those hours so no real appointment is
 * hidden by the clinic's own configuration.
 */
export function halfHourRows(
  days: GridDay[],
  bounds: { dayOpenMin: number; dayCloseMin: number },
): number[] {
  let first = floorRow(bounds.dayOpenMin);
  let last = ceilRow(bounds.dayCloseMin); // exclusive

  for (const day of days) {
    for (const b of day.bookings) {
      if (b.endMin <= b.startMin) continue;
      first = Math.min(first, floorRow(b.startMin));
      last = Math.max(last, ceilRow(b.endMin));
    }
    // A hand-made block is only ever created on a row that was on screen — but the
    // clinic's opening hours can change under an old block, and a block nobody can
    // see is a block nobody can undo.
    for (const startMin of day.blockedStarts ?? []) {
      first = Math.min(first, floorRow(startMin));
      last = Math.max(last, ceilRow(startMin + ROW_MIN));
    }
  }

  const rows: number[] = [];
  for (let min = first; min < last; min += ROW_MIN) rows.push(min);
  return rows;
}

/** Whether `busy` — this exact booking — covers the row starting at `rowStart`. */
function coveredBy(busy: AgendaBooking, rowStart: number): boolean {
  return busy.startMin < rowStart + ROW_MIN && busy.endMin > rowStart;
}

/** The booking covering `[rowStart, rowStart + 30)`, if any. */
function bookingAt(bookings: AgendaBooking[], rowStart: number): AgendaBooking | undefined {
  const rowEnd = rowStart + ROW_MIN;
  return bookings.find((b) => b.startMin < rowEnd && b.endMin > rowStart);
}

/**
 * One cell: what `day` is doing during the half hour starting at `rowStart`.
 *
 * A real appointment outranks a hand-made block on the same half hour. Both read
 * as "x", so the only thing the order decides is which one the click acts on —
 * and clicking away a block that is hiding a patient would be a lie. An "open"
 * decision is the other way round and DOES outrank the appointment: it exists
 * precisely to say "we know, offer it anyway".
 */
export function cellAt(day: GridDay, rowStart: number): GridCell {
  const opened = (day.openedStarts ?? []).includes(rowStart);
  const busy = bookingAt(day.bookings, rowStart);

  if (!busy) {
    // An "open" on a half hour with nothing booked on it is inert, not a hole.
    return (day.blockedStarts ?? []).includes(rowStart) ? { kind: "blocked" } : { kind: "idle" };
  }
  if (opened) return { kind: "opened", startMin: busy.startMin, endMin: busy.endMin };

  return {
    kind: "busy",
    // Labelled once per unbroken run, not once per appointment: opening a half
    // hour in the middle of a long booking splits it into two blocks on screen,
    // and the second one has to be marked or it reads as an empty grey cell.
    first: !coveredBy(busy, rowStart - ROW_MIN) || (day.openedStarts ?? []).includes(rowStart - ROW_MIN),
    startMin: busy.startMin,
    endMin: busy.endMin,
  };
}

/**
 * Whether Gestek has an appointment on this half hour — before anything the
 * clinic said about it.
 *
 * The grid needs this separately from `cellAt` because an opened cell must still
 * know there is a patient underneath: that is what a click on it takes back, and
 * what the save warns about.
 */
export function isBooked(day: Pick<AgendaDay, "bookings">, rowStart: number): boolean {
  return bookingAt(day.bookings, rowStart) !== undefined;
}

/** "11:45 - 12:45", for the tooltip on a busy block. */
export function rangeLabel(startMin: number, endMin: number): string {
  return `${minutesToHhmm(startMin)} - ${minutesToHhmm(endMin)}`;
}
