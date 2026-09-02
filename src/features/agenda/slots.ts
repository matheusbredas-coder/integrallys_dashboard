/**
 * Appointment slot packing — the rule that keeps the clinic's day contiguous.
 *
 * A deliberate port of the bot's `src/booking/slots.ts`, so the times this
 * dashboard shows the caller are exactly the times the bot would offer a lead on
 * WhatsApp. The bot is internal-only on the VPS (its public hostname 502s by
 * design) and cannot be called from Vercel, so the rule is duplicated rather than
 * shared. If one side changes, change the other — a caller offering a time the
 * bot would refuse puts a hole back in the professional's day.
 *
 * Gestek's `agenda-disponivel` already answers "which start times are free",
 * accounting for existing bookings and whether the requested duration fits. What
 * it will not do is care about the SHAPE of the resulting day: with appointments
 * running 11:00-14:00 it happily offers 18:00, which books one patient into an
 * otherwise dead evening and strands four unusable hours in between.
 *
 * This module applies the clinic's actual preference on top: an offered time must
 * grow an existing block rather than start an island. It also applies the
 * 15-minute preparation window between appointments, which Gestek knows nothing about.
 *
 * All times are CLINIC-LOCAL minutes from midnight — conversion happens once, at
 * the edge, in time.ts.
 */

/** A stretch of the day that is already spoken for, in local minutes from midnight. */
export interface BusyInterval {
  start: number;
  end: number;
}

/** One of Gestek's bookings, reduced to what packing actually needs. */
export interface RawBusyBooking {
  startMin: number;
  /** `procedimentos[].duracaoMinutos`. Empty on owner self-blocks. */
  procedureDurations: number[];
}

export interface PackSlotsInput {
  /** Free start times from `agenda-disponivel`, as "HH:MM", clinic-local. */
  freeSlots: string[];
  /** The day's real bookings. Authoritative — staff book outside the grid. */
  bookings: BusyInterval[];
  /** How long the appointment being booked runs. */
  durationMin: number;
  /** Preparation window required on BOTH sides of every appointment. */
  bufferMin: number;
  dayOpenMin: number;
  dayCloseMin: number;
  /**
   * How much dead time an offer may create before it is refused.
   *
   * This is a tolerance for the grid, not a slackening of the rule. Gestek offers
   * only :00 and :30, while real appointments end at arbitrary minutes — a booking
   * ending 12:25 needs a 12:40 start to clear the buffer, but the earliest offer
   * available is 13:00. Without tolerance that pairing would be rejected and a
   * perfectly contiguous day would be skipped.
   */
  maxGapMin: number;
}

export interface PackedSlot {
  /** "HH:MM", clinic-local — the form the caller reads out loud. */
  time: string;
  startMin: number;
  endMin: number;
  /** Minutes stranded by taking this slot. 0 = flush against its anchor. */
  deadTime: number;
  /** What the slot grows from: a real appointment, or the day's first free time. */
  anchor: "booking" | "day-open";
}

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "14:30" -> 870. Null for anything that is not a wall-clock time. */
export function hhmmToMinutes(hhmm: string): number | null {
  const match = HHMM.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 870 -> "14:30". */
export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Gestek bookings -> occupied intervals.
 *
 * A booking's real length is the sum of its procedures, because one appointment
 * routinely stacks several (a 30min BOTOX plus a 30min MICROAGULHAMENTO occupies
 * an hour). Bookings with no usable duration — owner self-blocks arrive with
 * `procedimentos: []` — fall back to `defaultDurationMin` rather than collapsing
 * to a zero-length interval that the packer would then happily book over.
 */
export function toBusyIntervals(bookings: RawBusyBooking[], defaultDurationMin: number): BusyInterval[] {
  return bookings.map((b) => {
    const total = b.procedureDurations.reduce((sum, d) => sum + (d > 0 ? d : 0), 0);
    return { start: b.startMin, end: b.startMin + (total > 0 ? total : defaultDurationMin) };
  });
}

/** True when [start, end] leaves at least `buffer` clear on both sides of `busy`. */
function clearsBuffer(start: number, end: number, busy: BusyInterval, buffer: number): boolean {
  return end + buffer <= busy.start || start >= busy.end + buffer;
}

/**
 * Minutes stranded between this slot and its nearest neighbouring booking.
 *
 * Measured against the CLOSEST booking on either side and minimised, not summed:
 * a slot that lands flush after one appointment is contiguous even if the rest of
 * the afternoon is open, and a slot that fills an interior gap is anchored on both
 * sides. Taking the maximum instead would reject exactly the interior fills this
 * rule exists to encourage.
 */
function deadTimeAgainst(start: number, end: number, bookings: BusyInterval[], buffer: number): number {
  let best = Infinity;
  for (const busy of bookings) {
    if (end + buffer <= busy.start) best = Math.min(best, busy.start - (end + buffer));
    else if (start >= busy.end + buffer) best = Math.min(best, start - (busy.end + buffer));
  }
  return best;
}

/**
 * The offerable times for one day, best first.
 *
 * A slot survives when it (a) sits inside opening hours, (b) clears every existing
 * appointment's preparation window, and (c) strands no more than `maxGapMin`.
 *
 * On a day with NO bookings there is nothing to be flush against, so the rule
 * anchors on the first time Gestek offers that day instead — otherwise a
 * completely free day would produce zero offers and the page would claim there is
 * no availability. That fallback also biases the first booking of a day toward the
 * start of the professional's schedule, so the block forms from the top down.
 */
export function packSlots(input: PackSlotsInput): PackedSlot[] {
  const { freeSlots, bookings, durationMin, bufferMin, dayOpenMin, dayCloseMin, maxGapMin } = input;
  const anchor: PackedSlot["anchor"] = bookings.length > 0 ? "booking" : "day-open";

  const candidates = freeSlots
    .map((raw) => hhmmToMinutes(raw))
    // Undocumented response schema; skip the entry, don't crash the page.
    .filter((startMin): startMin is number => startMin !== null)
    .filter((startMin) => startMin >= dayOpenMin && startMin + durationMin <= dayCloseMin)
    .sort((a, b) => a - b);

  /**
   * What an empty day measures its dead time from: the first time Gestek actually
   * offers, NOT the configured opening. The two diverge whenever the professional's
   * own Gestek schedule starts later than the clinic's doors — verified live, where
   * the clinic opens at 09:00 and `agenda-disponivel` returns nothing before 12:00.
   */
  const dayAnchorMin = candidates[0] ?? dayOpenMin;
  const packed: PackedSlot[] = [];

  for (const startMin of candidates) {
    const endMin = startMin + durationMin;
    if (!bookings.every((busy) => clearsBuffer(startMin, endMin, busy, bufferMin))) continue;

    const deadTime =
      anchor === "day-open" ? startMin - dayAnchorMin : deadTimeAgainst(startMin, endMin, bookings, bufferMin);
    if (!Number.isFinite(deadTime) || deadTime > maxGapMin) continue;

    packed.push({ time: minutesToHhmm(startMin), startMin, endMin, deadTime, anchor });
  }

  return packed.sort((a, b) => a.deadTime - b.deadTime || a.startMin - b.startMin);
}
