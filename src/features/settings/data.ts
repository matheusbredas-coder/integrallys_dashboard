import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Goals } from "@/features/overview/types";
import { DEFAULT_GOALS } from "./goals";

/** Current goals = seeded defaults with any app_settings overrides applied.
 *  Mirrors the merge in features/overview/data.ts so the form and the gauges
 *  always read the same numbers. */
export async function getGoals(): Promise<Goals> {
  const sb = createSupabaseServiceClient();
  const { data } = await sb.from("app_settings").select("key, value");
  const goals: Goals = { ...DEFAULT_GOALS };
  for (const row of data ?? []) {
    if (row.key in goals) (goals as Record<string, number>)[row.key] = Number(row.value);
  }
  return goals;
}
