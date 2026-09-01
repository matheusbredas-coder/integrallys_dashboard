/**
 * Which board column a lead sits in, and in what order within it.
 *
 * Pure, like call-cadence.ts — the board component does no derivation of its own.
 *
 * The rule is deliberately trivial: one field decides, so there is no precedence
 * puzzle between the caller's board and the funnel. `stage` is READ here only to
 * highlight a lead who answered the bot; it never decides a column and is never
 * written. See BOARD_COLUMNS in types.ts for why the two are kept apart.
 */

import { A_LIGAR, isBoardColumn, type BoardColumnKey, type FormLeadRow } from "./types";

/** Columns whose leads the caller is finished with, for the recency cut below. */
const TERMINAL_COLUMNS: ReadonlySet<BoardColumnKey> = new Set<BoardColumnKey>([
  "qualificado",
  "agendado",
  "removido",
]);

/** How long a finished lead stays on the board before only the table has her. */
export const TERMINAL_VISIBLE_DAYS = 14;

export function boardColumnFor(row: FormLeadRow): BoardColumnKey {
  // Tolerates a legacy or hand-edited value in the column, the same way
  // stageLabel() tolerates an unknown stage: an unrecognized value must put the
  // lead back in the first column, never throw and blank the whole board.
  return isBoardColumn(row.board_column) ? row.board_column : A_LIGAR;
}

/**
 * Sort key within a column. Lower sorts first.
 *
 * A lead who has answered the bot on WhatsApp is the hottest thing on the board —
 * she raised her hand — so she pins to the top of whatever column she is in rather
 * than being findable only by spotting a badge in a stack of cards.
 *
 * After that it is "who is due soonest": a column sorted by attempt count would make
 * the caller scan for dates by eye. Leads with no due date (three attempts spent, or
 * a terminal column) sink to the bottom.
 */
export function sortKeyFor(row: FormLeadRow): [number, number] {
  const answered = row.stage === "respondeu" ? 0 : 1;
  const due = row.next_call_at ? new Date(row.next_call_at).getTime() : Number.POSITIVE_INFINITY;
  return [answered, Number.isNaN(due) ? Number.POSITIVE_INFINITY : due];
}

export function compareForBoard(a: FormLeadRow, b: FormLeadRow): number {
  const [aAnswered, aDue] = sortKeyFor(a);
  const [bAnswered, bDue] = sortKeyFor(b);
  if (aAnswered !== bAnswered) return aAnswered - bAnswered;
  if (aDue !== bDue) return aDue - bDue;
  // Stable tiebreak so the board doesn't reshuffle between renders.
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
}

/**
 * Whether a lead belongs on the board at all.
 *
 * Everything still being worked stays; a lead the caller has finished with drops off
 * after TERMINAL_VISIBLE_DAYS so the terminal columns don't grow without bound. The
 * table below the board still lists every lead, always.
 *
 * `todayIso` is a DATE ("YYYY-MM-DD"), not an instant, on purpose: the board renders
 * on the server and again on the client, and comparing instants would put the cut in
 * a different place in the two passes and hydrate mismatched.
 */
export function visibleOnBoard(row: FormLeadRow, todayIso: string): boolean {
  const column = boardColumnFor(row);
  if (!TERMINAL_COLUMNS.has(column)) return true;

  const since = row.last_call_at ?? row.updated_at ?? row.created_at;
  if (!since) return true;
  const cutoff = new Date(`${todayIso}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - TERMINAL_VISIBLE_DAYS);
  return since.slice(0, 10) >= cutoff.toISOString().slice(0, 10);
}

/** Group the visible leads into their columns, each already sorted. */
export function groupForBoard(
  rows: FormLeadRow[],
  todayIso: string,
): Map<BoardColumnKey, FormLeadRow[]> {
  const grouped = new Map<BoardColumnKey, FormLeadRow[]>();
  for (const row of rows) {
    if (!visibleOnBoard(row, todayIso)) continue;
    const column = boardColumnFor(row);
    const bucket = grouped.get(column);
    if (bucket) bucket.push(row);
    else grouped.set(column, [row]);
  }
  for (const bucket of grouped.values()) bucket.sort(compareForBoard);
  return grouped;
}
