/**
 * When the caller should next phone a form lead.
 *
 * The cadence is the one written down in docs/roteiro-ligacao.md: two calls on the
 * day the lead arrives (or the next day if she arrives after 19h), and — if neither
 * is answered — a third call two days later. Nothing here does I/O or reads the
 * clock; `now` is always passed in, same as features/capi/event.ts, so every branch
 * is trivially testable.
 *
 * America/Sao_Paulo is a fixed UTC-3: Brazil dropped DST in 2019, and
 * src/lib/format.ts already leans on that. Doing the arithmetic against a constant
 * offset rather than round-tripping through toLocaleString keeps this pure and
 * exact. If Brazil ever reinstates DST, this file and format.ts are what break.
 */

const BRT_OFFSET_MS = 3 * 3600_000;

/** The clinic answers the phone 09h–19h, Monday to Friday (roteiro §01). */
const OPENS_HOUR = 9;
const CLOSES_HOUR = 19;

/** Gap between the first and second call on the arrival day. */
const SAME_DAY_GAP_MS = 2 * 3600_000;

/** Latest a call may be placed: enough of a margin before closing to hold one. */
const LAST_CALL_BEFORE_CLOSE_MS = 30 * 60_000;

/** Business days to wait before the third and last call. */
const THIRD_CALL_BUSINESS_DAYS = 2;

/** Three tries and the phone track is done; the bot's WhatsApp follow-ups continue. */
export const MAX_CALL_ATTEMPTS = 3;

/** How far ahead the caller may schedule a callback. */
const MAX_CALLBACK_DAYS = 90;

/** The same instant, shifted so UTC getters read as BRT wall-clock time. */
function toBrtParts(d: Date): Date {
  return new Date(d.getTime() - BRT_OFFSET_MS);
}

/** Inverse of toBrtParts: a BRT wall clock back to the real instant. */
function fromBrtParts(d: Date): Date {
  return new Date(d.getTime() + BRT_OFFSET_MS);
}

function isWeekend(brtParts: Date): boolean {
  const day = brtParts.getUTCDay();
  return day === 0 || day === 6;
}

/** That BRT day at a given hour, as a real instant. */
function atHour(brtParts: Date, hour: number): Date {
  const d = new Date(brtParts);
  d.setUTCHours(hour, 0, 0, 0);
  return fromBrtParts(d);
}

/** Opening time on the next business day at or after the given BRT day. */
function nextBusinessOpening(brtParts: Date, skipDays: number): Date {
  const d = new Date(brtParts);
  d.setUTCDate(d.getUTCDate() + skipDays);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() + 1);
  return atHour(d, OPENS_HOUR);
}

/** Opening time `days` BUSINESS days after the given BRT day (weekends skipped). */
function addBusinessDays(brtParts: Date, days: number): Date {
  const d = new Date(brtParts);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (!isWeekend(d)) left--;
  }
  return atHour(d, OPENS_HOUR);
}

/**
 * When the next call is due, given how many have already been made.
 *
 *   0 attempts -> due now (she just arrived and nobody has called)
 *   1 attempt  -> the second call, later the same day; after hours, next morning
 *   2 attempts -> the third and last call, two business days out
 *   3+         -> null; the caller is done with her
 */
export function nextCallAfter(attempts: number, now: Date): Date | null {
  if (attempts >= MAX_CALL_ATTEMPTS) return null;
  if (attempts <= 0) return now;

  const nowParts = toBrtParts(now);

  if (attempts === 1) {
    // Second call the same day is the whole point of the cadence, so it only rolls
    // over when the clinic is actually shut — a weekend, or past closing time.
    if (isWeekend(nowParts)) return nextBusinessOpening(nowParts, 0);
    if (nowParts.getUTCHours() >= CLOSES_HOUR) return nextBusinessOpening(nowParts, 1);

    const candidate = new Date(now.getTime() + SAME_DAY_GAP_MS);
    const lastSlot = new Date(atHour(nowParts, CLOSES_HOUR).getTime() - LAST_CALL_BEFORE_CLOSE_MS);
    // Clamp rather than roll: she arrived today and the roteiro promises her two
    // calls today, so a 17:30 first attempt still gets its pair before closing.
    return candidate.getTime() > lastSlot.getTime() ? lastSlot : candidate;
  }

  return addBusinessDays(nowParts, THIRD_CALL_BUSINESS_DAYS);
}

/**
 * A callback time the caller typed, snapped into business hours — or null if it is
 * unusable. Runs on the server, because the board is not the only thing that can
 * reach the action: a hand-crafted POST must not be able to schedule a callback for
 * 03:00 on a Sunday.
 */
export function normalizeCallbackAt(iso: string | null | undefined, now: Date): Date | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getTime() < now.getTime()) return null;
  if (parsed.getTime() > now.getTime() + MAX_CALLBACK_DAYS * 86_400_000) return null;

  const parts = toBrtParts(parsed);
  if (isWeekend(parts)) return nextBusinessOpening(parts, 0);

  const hour = parts.getUTCHours();
  if (hour < OPENS_HOUR) return atHour(parts, OPENS_HOUR);
  if (hour >= CLOSES_HOUR) return nextBusinessOpening(parts, 1);
  return parsed;
}
