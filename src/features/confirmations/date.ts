// Pure date helper for the appointment-confirmation cron. No imports beyond the
// language so it stays trivially unit-testable (mirrors attendance/parse.ts's
// SP_OFFSET_HOURS convention).

// The clinic runs in America/Sao_Paulo, which is a fixed UTC-3 (Brazil dropped DST in 2019).
const SP_OFFSET_HOURS = 3;

/** "Tomorrow" as a YYYY-MM-DD calendar date in the clinic's local (BRT) time. */
export function tomorrowDayISO(now: Date = new Date()): string {
  const brt = new Date(now.getTime() - SP_OFFSET_HOURS * 60 * 60 * 1000);
  brt.setUTCDate(brt.getUTCDate() + 1);
  const y = brt.getUTCFullYear();
  const m = String(brt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(brt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
