import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { computeOverview } from "./aggregate";
import type { OverviewData, Goals } from "./types";

const DEFAULT_GOALS: Goals = { monthly_revenue_goal: 65000, monthly_new_patient_goal: 30, avg_ticket_goal: 280 };

export async function getOverviewData(now = new Date()): Promise<OverviewData> {
  const sb = createSupabaseServiceClient();
  const [vendasRes, clientesRes, settingsRes] = await Promise.all([
    sb.from("vendas_view").select("sold_at, cliente_supabase_id, cliente_nome, total, valor_pago, procedimentos"),
    sb.from("clientes_view").select("id, cadastro_at"),
    sb.from("app_settings").select("key, value"),
  ]);
  if (vendasRes.error) throw vendasRes.error;
  if (clientesRes.error) throw clientesRes.error;

  const goals: Goals = { ...DEFAULT_GOALS };
  for (const row of settingsRes.data ?? []) {
    if (row.key in goals) (goals as Record<string, number>)[row.key] = Number(row.value);
  }
  return computeOverview(vendasRes.data ?? [], clientesRes.data ?? [], goals, now);
}
