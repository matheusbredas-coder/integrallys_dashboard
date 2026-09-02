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

export interface AgendaDay {
  dateISO: string;
  /** 0 = Sunday, matching Date#getUTCDay. */
  weekday: number;
  outcome: DayOutcome;
  /** Offerable times, chronological. Empty unless `outcome` is "ok". */
  slots: PackedSlot[];
  /** How many appointments Gestek already has that day. Null when it could not be read. */
  bookedCount: number | null;
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
