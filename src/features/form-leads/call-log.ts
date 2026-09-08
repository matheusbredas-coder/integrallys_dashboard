/**
 * The history behind the caller's board: when each call was actually placed.
 *
 * Migration 028 counts the calls (`call_attempts`) and remembers the most recent one
 * (`last_call_at`), which is all the board needs to decide who to phone next. It is
 * not enough to answer "when did she get the first call?", because `last_call_at` is
 * overwritten in place — so migration 030 adds `call_log`, one ISO string per attempt,
 * oldest first. This module is the only thing that reads or writes that shape.
 *
 * Everything here is pure and takes its input rather than reading the clock or the DB,
 * same as call-cadence.ts: the write side runs in a server action, the read side runs
 * in the notes drawer, and both have to be testable without either.
 */

import { MAX_CALL_ATTEMPTS } from "./call-cadence";
import type { FormLeadRow } from "./types";

/** One call, numbered as the caller counts them: the 1st, the 2nd, the 3rd. */
export type CallLogEntry = { attempt: number; at: string };

/**
 * The stored column as a list of ISO strings.
 *
 * `call_log` is permissive jsonb — the app is what keeps it clean (the same split
 * migration 028 made for `board_column`), so anything that is not a real date is
 * dropped here rather than allowed to reach a `new Date()` on screen.
 */
export function parseCallLog(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is string => typeof v === "string" && !Number.isNaN(new Date(v).getTime()),
  );
}

/**
 * The log with one more call on the end, capped like the attempts it mirrors.
 *
 * The cap drops from the front rather than refusing to append: a log that somehow
 * ran past three entries should still end at the newest call, since that is the one
 * `last_call_at` agrees with.
 */
export function appendCall(log: string[], atIso: string): string[] {
  return [...log, atIso].slice(-MAX_CALL_ATTEMPTS);
}

/**
 * What the notes drawer lists, newest last.
 *
 * Two things make this more than a `map`. A lead worked before migration 030 has an
 * empty log and a `last_call_at`, and that one known time is worth showing — so it
 * stands in for the log. And a lead worked on both sides of the migration has a log
 * SHORTER than her attempt count, where the logged times are the LAST calls she got:
 * numbering them from 1 would date her history wrong, so the numbering is anchored to
 * the attempt count and counts backwards from the end.
 */
export function callLogEntries(row: FormLeadRow): CallLogEntry[] {
  const logged = parseCallLog(row.call_log);
  const known =
    logged.length > 0
      ? logged
      : row.call_attempts > 0 && row.last_call_at
        ? [row.last_call_at]
        : [];

  const firstAttempt = Math.max(row.call_attempts - known.length, 0) + 1;
  return known.map((at, i) => ({ attempt: firstAttempt + i, at }));
}

/**
 * A call as the caller reads it: "qui 03/09 14:32".
 *
 * The weekday earns its place — the history is a list of near-identical timestamps,
 * and "quinta" is what someone actually remembers about a call. pt-BR renders it
 * abbreviated with a trailing dot in current CLDR ("qui.") and without it in older
 * ICU builds, so the dot is stripped either way.
 */
export function formatCallAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const weekday = get("weekday").replace(/\.$/, "").toLowerCase();
  return `${weekday} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}
