/**
 * The clinic's booking policy, mirroring the bot's `config/default.config.json`
 * (`booking` block) so the dashboard offers the same times the bot does.
 *
 * These are business settings, not secrets — the bot keeps them in a config file
 * for the same reason. The two Gestek resource ids are read from the environment
 * when present (the bot's `GESTEK_PROFISSIONAL_ID` / `GESTEK_SALA_ID`) and fall
 * back to the clinic's live ids, so this works on Vercel without a new env var.
 *
 * ⚠️ If a value here changes, change it in the bot too. A caller offering a time
 * the bot would refuse is exactly the hole in the day this whole feature exists
 * to prevent.
 */

import { hhmmToMinutes } from "./slots";

/** Gestek ids for the professional, room and procedure the evaluation is booked as. */
export const GESTEK_PROFISSIONAL_ID = process.env.GESTEK_PROFISSIONAL_ID || "688019b1e32861b9fbbcc5a8";
export const GESTEK_SALA_ID = process.env.GESTEK_SALA_ID || "688019b1e32861b9fbbcc5b6";
export const GESTEK_PROCEDIMENTO_IDS = (process.env.GESTEK_PROCEDIMENTO_IDS || "6a7bb0aff934c2b0658294b8")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/** How far the week arrows may travel, in weeks either side of the current one. */
export const MAX_WEEK_OFFSET = 8;

export interface BookingRules {
  /** How long the evaluation blocks the agenda. Never disclosed to the lead. */
  durationMin: number;
  /** Preparation window on both sides of every appointment. */
  bufferMin: number;
  /** Dead time an offer may create before it is refused. */
  maxGapMin: number;
  dayOpenMin: number;
  dayCloseMin: number;
  /** Days the clinic actually works. 0 = Sunday. */
  workdays: number[];
  /** One-off closures ("YYYY-MM-DD") — holidays, staff leave. */
  closedDates: string[];
  /** Never show a time sooner than this from now: nobody can make a 20-minute notice. */
  leadTimeMin: number;
  /** Duration assumed for an existing booking that carries no procedures. */
  defaultBookingDurationMin: number;
}

const OPENS_AT = "11:30";
const LAST_BOOKING_AT = "18:00";
const DURATION_MIN = 30;

export const BOOKING_RULES: BookingRules = {
  durationMin: DURATION_MIN,
  bufferMin: 15,
  maxGapMin: 30,
  dayOpenMin: hhmmToMinutes(OPENS_AT)!,
  // The packer works in "everything must be finished by", the clinic speaks in
  // "the last appointment I take" — same derivation as the bot's rules.ts.
  dayCloseMin: hhmmToMinutes(LAST_BOOKING_AT)! + DURATION_MIN,
  workdays: [1, 2, 3, 4, 5],
  closedDates: [],
  leadTimeMin: 120,
  defaultBookingDurationMin: 30,
};
