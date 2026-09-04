import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ROW_MIN } from "./grid";

/**
 * The half hours the clinic decided by hand, read and written straight from
 * `agenda_manual_blocks` (migration 029).
 *
 * Two directions, and the direction is stored rather than inferred:
 *   - `block` closes a half hour Gestek shows as free;
 *   - `open` offers a half hour Gestek shows as taken, which is how a cancellation
 *     nobody removed from Gestek — or one of the fake appointments the clinic used
 *     to create to hold time — is given back.
 *
 * Deliberately NOT inside the `unstable_cache` that wraps the Gestek week. The
 * two have opposite requirements: Gestek is expensive and rate-limited so it is
 * cached for 60s, while a decision must appear the instant it is saved. Caching
 * them together would mean every save either shows a stale grid or costs ten live
 * Gestek reads — see data.ts.
 *
 * Every read degrades to "the clinic decided nothing" rather than throwing. Until
 * the migration is applied the table does not exist, and an agenda that 500s is
 * far worse than one drawn from Gestek alone.
 */

const TABLE = "agenda_manual_blocks";

/** What one row can say. Stored as plain text; validated here, not by the DB. */
export type OverrideKind = "block" | "open";

export interface DayOverrides {
  /** Half hours closed by hand, as clinic-local start minutes. */
  blocked: number[];
  /** Half hours offered despite a Gestek appointment. */
  opened: number[];
}

export const isOverrideKind = (kind: unknown): kind is OverrideKind =>
  kind === "block" || kind === "open";

/** What the clinic decided per "YYYY-MM-DD", for `[fromISO, throughISO]` inclusive. */
export async function getAgendaOverrides(
  fromISO: string,
  throughISO: string,
): Promise<Record<string, DayOverrides>> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from(TABLE)
    .select("date, start_min, kind")
    .gte("date", fromISO)
    .lte("date", throughISO);

  if (error) {
    console.error("[agenda:blocks] read failed, drawing the week from Gestek alone:", error.message);
    return {};
  }

  const byDate: Record<string, DayOverrides> = {};
  for (const row of data ?? []) {
    const date = String(row.date).slice(0, 10);
    const day = (byDate[date] ??= { blocked: [], opened: [] });
    // An unknown kind is dropped rather than guessed: the two directions do
    // opposite things, and picking the wrong one hands out a booked half hour.
    if (row.kind === "open") day.opened.push(Number(row.start_min));
    else if (row.kind === "block") day.blocked.push(Number(row.start_min));
  }
  for (const day of Object.values(byDate)) {
    day.blocked.sort((a, b) => a - b);
    day.opened.sort((a, b) => a - b);
  }
  return byDate;
}

/**
 * Record — or withdraw — the clinic's decision about a set of half hours on one day.
 *
 * `kind` null withdraws: the half hour goes back to whatever Gestek says. Both
 * directions are idempotent (an upsert that overwrites, a delete of whatever is
 * there), which is what lets a drag be sent as one call without the client having
 * to know what each cell was, and what makes a double-fired event harmless.
 */
export async function writeAgendaOverrides(
  dateISO: string,
  startMins: number[],
  kind: OverrideKind | null,
  by: string | null,
): Promise<{ ok: true } | { error: string }> {
  if (startMins.length === 0) return { ok: true };
  const sb = createSupabaseServiceClient();

  const { error } = kind
    ? await sb
        .from(TABLE)
        .upsert(
          startMins.map((start_min) => ({ date: dateISO, start_min, kind, created_by: by })),
          { onConflict: "date,start_min" },
        )
    : await sb.from(TABLE).delete().eq("date", dateISO).in("start_min", startMins);

  if (error) {
    console.error("[agenda:blocks] write failed", error);
    return { error: "Não foi possível salvar as alterações da agenda." };
  }
  return { ok: true };
}

/** A start minute the grid could actually have drawn: on the ladder, inside a day. */
export function isGridStart(startMin: unknown): startMin is number {
  return (
    typeof startMin === "number" &&
    Number.isInteger(startMin) &&
    startMin >= 0 &&
    startMin < 24 * 60 &&
    startMin % ROW_MIN === 0
  );
}
