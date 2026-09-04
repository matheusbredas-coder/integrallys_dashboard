import type { PackedSlot } from "./slots";

/**
 * Why one day shows no times, so the caller reads a reason instead of a blank cell.
 *
 * "The clinic is shut on Saturday" and "Friday is booked solid" are different
 * facts, and an undifferentiated empty column makes her phone the clinic to ask.
 * Mirrors the bot's `DayOutcome` (booking/search.ts).
 */
export type DayOutcome =
  | "ok"
  /** Weekday the clinic does not work, or a configured one-off closure. */
  | "closed"
  /** Already gone by. */
  | "past"
  /** Open, but nothing packs without stranding time. */
  | "full"
  /** Times exist, but all inside the two-hour minimum notice. */
  | "too-late"
  /** Gestek would not answer for this day. */
  | "error";

/**
 * One appointment already on the diary, reduced to what the grid draws.
 *
 * The table shows OCCUPANCY, so the booking's real extent matters, not just its
 * start: a 60-minute appointment has to paint two half-hour rows or the caller
 * reads the second one as free and double-books it.
 *
 * Deliberately just an interval: the patient's name is dropped here rather than
 * merely hidden in the markup, so it never reaches the browser at all. The page
 * sits open on a desk, and "que horário está livre?" does not need a name.
 */
export interface AgendaBooking {
  /** Minutes from clinic-local midnight. */
  startMin: number;
  /** Start plus the summed procedure durations (or the configured fallback). */
  endMin: number;
}

export interface AgendaDay {
  dateISO: string;
  /** 0 = Sunday, matching Date#getUTCDay. */
  weekday: number;
  outcome: DayOutcome;
  /** Offerable times, chronological. Empty unless `outcome` is "ok". */
  slots: PackedSlot[];
  /**
   * What is already booked that day, chronological. Empty when Gestek was never
   * asked (weekend, past day) or would not answer.
   */
  bookings: AgendaBooking[];
  /** How many appointments Gestek already has that day. Null when it could not be read. */
  bookedCount: number | null;
  /**
   * Half hours closed BY HAND from the grid, as clinic-local start minutes.
   *
   * A separate layer from `bookings` on purpose: these come from the CRM's own
   * table (migration 029), not from Gestek, and they are the only cells a click
   * can take back off. Left as an overlay rather than folded into `bookings` or
   * subtracted from `slots`, so undoing one restores exactly the day that was
   * there before — nothing to recompute, nothing to get wrong.
   *
   * The bot applies the same decisions to what it OFFERS, in its own
   * `src/booking/blocks.ts`. A time closed here is a time it never proposes.
   */
  blockedStarts: number[];
  /**
   * Half hours the clinic hands back out DESPITE a Gestek appointment sitting on
   * them — a cancellation nobody removed from Gestek, or one of the fake
   * appointments the clinic used to create to hold time.
   *
   * This one is an override of `bookings`, not of free time, and it does NOT
   * cancel anything in Gestek: the appointment is still there, and offering the
   * time again is the clinic's decision to make, not this dashboard's to hide.
   * On a half hour with nothing booked on it there is nothing to draw differently,
   * so the grid shows it as the free cell it already is.
   */
  openedStarts: number[];
}

export interface AgendaWeek {
  /** Monday of the week shown, clinic-local. */
  weekStartISO: string;
  /** Offset in weeks from the current one. 0 = this week. */
  offset: number;
  days: AgendaDay[];
  /** When the Gestek reads happened, as a clinic-local "HH:MM". */
  fetchedAt: string;
}
