import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computeOverview } from "./aggregate";
import type { OverviewData, OverviewSource, Goals } from "./types";

const DEFAULT_GOALS: Goals = { monthly_revenue_goal: 65000, monthly_new_patient_goal: 30, avg_ticket_goal: 280 };

export async function getOverviewSource(now = new Date()): Promise<OverviewSource> {
  const sb = createSupabaseServiceClient();
  const [vendasRes, clientesRes, agendaRes, settingsRes] = await Promise.all([
    sb.from("vendas_view").select("sold_at, cliente_supabase_id, cliente_nome, total, valor_pago, procedimentos"),
    sb.from("clientes_view").select("id, cadastro_at"),
    sb.from("agenda_view").select("appointment_at, pendente"),
    sb.from("app_settings").select("key, value"),
  ]);
  if (vendasRes.error) throw vendasRes.error;
  if (clientesRes.error) throw clientesRes.error;
  if (agendaRes.error) throw agendaRes.error;

  const goals: Goals = { ...DEFAULT_GOALS };
  for (const row of settingsRes.data ?? []) {
    if (row.key in goals) (goals as Record<string, number>)[row.key] = Number(row.value);
  }
  const recent = [...(vendasRes.data ?? [])]
    .sort((a, b) => String(b.sold_at).localeCompare(String(a.sold_at)))
    .slice(0, 8)
    .map((v) => ({ soldAt: String(v.sold_at), patient: v.cliente_nome ?? "—", procedimentos: v.procedimentos ?? "—", total: Number(v.total) || 0 }));

  return {
    vendas: vendasRes.data ?? [],
    clientes: clientesRes.data ?? [],
    agenda: agendaRes.data ?? [],
    goals,
    recent,
    nowIso: now.toISOString(),
  };
}

export async function getOverviewData(now = new Date()): Promise<OverviewData> {
  const source = await getOverviewSource(now);
  return computeOverview(source.vendas, source.clientes, source.goals, now, source.agenda);
}
