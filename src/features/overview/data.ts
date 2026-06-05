import "server-only";
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

export async function getOverviewSource(now = new Date()): Promise<OverviewSource> {
  const sb = createSupabaseServiceClient();
  const [vendas, clientes, agenda, settingsRes] = await Promise.all([
    selectAll<OverviewSource["vendas"][number]>(sb, "vendas_view", "sold_at, cliente_supabase_id, cliente_nome, total, valor_pago, valor_desconto, procedimentos"),
    selectAll<OverviewSource["clientes"][number]>(sb, "clientes_view", "id, cadastro_at"),
    selectAll<OverviewSource["agenda"][number]>(sb, "agenda_view", "appointment_at, status"),
    sb.from("app_settings").select("key, value"),
  ]);

  const goals: Goals = { ...DEFAULT_GOALS };
  for (const row of settingsRes.data ?? []) {
    if (row.key in goals) (goals as Record<string, number>)[row.key] = Number(row.value);
  }
  const recent = [...vendas]
    .sort((a, b) => String(b.sold_at).localeCompare(String(a.sold_at)))
    .slice(0, 8)
    .map((v) => ({ soldAt: String(v.sold_at), patient: v.cliente_nome ?? "—", procedimentos: v.procedimentos ?? "—", total: Number(v.total) || 0 }));

  return {
    vendas,
    clientes,
    agenda,
    goals,
    recent,
    nowIso: now.toISOString(),
  };
}
