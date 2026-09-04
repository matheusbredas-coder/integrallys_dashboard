"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isGridStart, isOverrideKind, writeAgendaOverrides, type OverrideKind } from "./blocks";

/**
 * Drop the 60-second availability cache.
 *
 * Exists because the one moment the cache is wrong is the moment it matters most:
 * the caller has just booked someone in Gestek and wants to see the day close up
 * before offering the next lead a time next to it.
 */
export async function refreshAgenda(): Promise<void> {
  revalidateTag("agenda", { expire: 0 });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Record the clinic's decision about a set of half hours on one day.
 *
 * `kind` is the whole vocabulary:
 *   "block" — leave this half hour alone, even though Gestek shows it free;
 *   "open"  — offer this half hour, even though Gestek has an appointment on it;
 *   null    — never mind, go back to whatever Gestek says.
 *
 * Takes a LIST of start minutes because the grid is dragged and then saved in one
 * go: a week's marks are a handful of calls, not one per cell.
 *
 * Note what this deliberately cannot do: it never touches Gestek. It cannot cancel
 * an appointment, and "open" does not cancel one either — the patient stays booked
 * in Gestek and the clinic has simply decided to offer the time again. All this
 * steers is what the dashboard draws and what the bot offers (Lead Qualifier Bot,
 * src/booking/blocks.ts).
 */
export async function setAgendaBlocks(
  dateISO: string,
  startMins: number[],
  kind: OverrideKind | null,
): Promise<{ ok: true } | { error: string }> {
  // The service-role client below bypasses RLS, so prove there is a real session
  // first — same guard as features/form-leads/actions.ts.
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  if (!ISO_DATE.test(dateISO)) return { error: "Data inválida." };
  if (kind !== null && !isOverrideKind(kind)) return { error: "Alteração inválida." };
  // A hand-crafted POST does not get to invent times off the ladder: everything
  // downstream (the grid, the bot's overlap check) assumes half-hour starts.
  const starts = [...new Set(startMins)];
  if (!starts.every(isGridStart)) return { error: "Horário inválido." };
  // A whole week of half hours is ~70 cells; anything past that is not a drag.
  if (starts.length > 96) return { error: "Seleção grande demais." };

  const result = await writeAgendaOverrides(dateISO, starts, kind, user.email ?? null);
  if ("error" in result) return result;

  // Only the page, not the "agenda" tag: these live outside that cache on purpose,
  // and expiring it here would buy ten live Gestek reads per save.
  revalidatePath("/marketing");
  return { ok: true };
}
