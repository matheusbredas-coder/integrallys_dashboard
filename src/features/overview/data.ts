import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { OverviewSource, Goals } from "./types";
import { DEFAULT_GOALS } from "@/features/settings/goals";

// PostgREST caps a single response at 1000 rows. These views grow unbounded
// (agenda already passed 1000), so page through with .range() until exhausted —
// otherwise recent rows silently fall outside the first page and counts read 0.
const PAGE = 1000;
type SbClient = ReturnType<typeof createSupabaseServiceClient>;
async function selectAll<T>(sb: SbClient, table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

async function fetchOverviewSource(now = new Date()): Promise<OverviewSource> {
  const sb = createSupabaseServiceClient();
  const [vendas, clientes, agenda, settingsRes, lastSyncRes] = await Promise.all([
    selectAll<OverviewSource["vendas"][number]>(sb, "vendas_view", "sold_at, created_at, cliente_supabase_id, cliente_nome, total, valor_pago, valor_desconto, procedimentos"),
    selectAll<OverviewSource["clientes"][number]>(sb, "clientes_view", "id, cadastro_at"),
    selectAll<OverviewSource["agenda"][number]>(sb, "agenda_view", "appointment_at, status"),
    sb.from("app_settings").select("key, value"),
    sb.from("gestek_sync_logs").select("started_at, completed_at, error").order("started_at", { ascending: false }).limit(10),
  ]);

  // Last *successful* run drives the freshness stamp; an error on the newest row means
  // the most recent attempt failed and the dashboard should warn, not just look stale.
  const logs = (lastSyncRes.data ?? []) as { started_at: string; completed_at: string | null; error: string | null }[];
  const lastOk = logs.find((l) => l.completed_at && !l.error);
  const lastSync = logs.length ? { lastOkAt: lastOk?.completed_at ?? null, lastError: logs[0].error } : null;

  const goals: Goals = { ...DEFAULT_GOALS };
  for (const row of settingsRes.data ?? []) {
    if (row.key in goals) (goals as Record<string, number>)[row.key] = Number(row.value);
  }
  return {
    vendas,
    clientes,
    agenda,
    goals,
    nowIso: now.toISOString(),
    lastSync,
  };
}

// Cache the heavy multi-view fetch for 60s so back-and-forth navigation
// doesn't re-page through thousands of rows on every visit. Safe to cache:
// fetchOverviewSource uses the service-role client (no cookies/session).
export const getOverviewSource = unstable_cache(
  () => fetchOverviewSource(),
  ["overview-source"],
  { revalidate: 60, tags: ["overview"] },
);
