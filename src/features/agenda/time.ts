/**
 * Clinic-local (America/Sao_Paulo) <-> UTC conversion, for the agenda pages.
 *
 * A deliberate port of the bot's `src/booking/time.ts`. The two live in separate
 * deploy units (the bot is internal-only on the VPS and unreachable from Vercel),
 * so the CRM cannot call it — the rules have to exist on both sides. Keep them in
 * step: everything here is copied, not invented.
 *
 * Gestek is inconsistent about which clock it speaks: `agenda-disponivel` returns
 * wall-clock strings in clinic-local time ("14:00"), while `GET /api/agenda`
 * returns `dataAgendamentoInicio` in UTC ("2026-08-13T14:30:00Z" = 11:30 local).
 * Mixing the two shifts every appointment by three hours, so conversion is
 * confined to this module.
 *
 * A fixed -03:00 offset rather than a tz lookup: Brazil abolished DST in 2019, so
 * São Paulo has been UTC-3 year-round ever since — the same assumption already
 * baked into features/confirmations.
 */

export const CLINIC_UTC_OFFSET_MIN = -180;

const MS_PER_MIN = 60_000;

export interface LocalParts {
  dateISO: string;
  minutes: number;
}

function toParts(ms: number): LocalParts {
  const shifted = new Date(ms + CLINIC_UTC_OFFSET_MIN * MS_PER_MIN);
  return {
    dateISO: shifted.toISOString().slice(0, 10),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** A UTC instant -> the clinic's calendar date and time of day. Null if unparseable. */
export function utcIsoToLocal(iso: string): LocalParts | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : toParts(ms);
}

/** A clinic-local date + time of day -> the UTC instant. */
export function localToUtcIso(dateISO: string, minutes: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!) + (minutes - CLINIC_UTC_OFFSET_MIN) * MS_PER_MIN;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** The clinic's calendar date right now. */
export function todayLocalISO(now: Date = new Date()): string {
  return toParts(now.getTime()).dateISO;
}

/** Calendar arithmetic on a "YYYY-MM-DD", DST-free by construction. */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/** Day of week for a local calendar date. 0 = Sunday, matching Date#getUTCDay. */
export function weekdayOfISO(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/** "2026-09-01" -> "01/09". What the table's column headers show. */
export function formatDayMonth(dateISO: string): string {
  const [, m, d] = dateISO.split("-");
  return `${d}/${m}`;
}
