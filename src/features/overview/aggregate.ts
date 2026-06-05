import { topProcedures } from "@/lib/procedimentos";
import type { VendaRow, ClienteRow, Goals, OverviewData, MonthPoint, Gauge } from "./types";

const ym = (iso: string) => iso.slice(0, 7);

export function computeOverview(vendas: VendaRow[], clientes: ClienteRow[], goals: Goals, now: Date): OverviewData {
  const revenueBilled = vendas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const revenueCollected = vendas.reduce((a, v) => a + (Number(v.valor_pago) || 0), 0);
  const sales = vendas.length;
  const buyers = new Set(vendas.map((v) => v.cliente_supabase_id).filter(Boolean)).size;
  const patients = clientes.length;

  const months = new Map<string, MonthPoint>();
  const bucket = (k: string) => months.get(k) ?? months.set(k, { month: k, revenue: 0, collected: 0, sales: 0, newPatients: 0 }).get(k)!;
  for (const v of vendas) { const b = bucket(ym(v.sold_at)); b.revenue += Number(v.total) || 0; b.collected += Number(v.valor_pago) || 0; b.sales += 1; }
  for (const c of clientes) if (c.cadastro_at) bucket(ym(c.cadastro_at)).newPatients += 1;
  const monthList = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));

  const thisMonth = ym(now.toISOString());
  const tm = months.get(thisMonth);
  const avgTicket = sales ? revenueBilled / sales : 0;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  const gauges: Gauge[] = [
    { key: "revenue", label: "Meta de receita", sub: "Este mês em relação à meta", value: brl(tm?.revenue ?? 0), pct: clamp((tm?.revenue ?? 0) / (goals.monthly_revenue_goal || 1)) },
    { key: "newPatients", label: "Novos pacientes", sub: "Este mês em relação à meta", value: String(tm?.newPatients ?? 0), pct: clamp((tm?.newPatients ?? 0) / (goals.monthly_new_patient_goal || 1)) },
    { key: "conversion", label: "Conversão", sub: "Pacientes que compraram", value: pct(buyers, patients), pct: clamp(patients ? buyers / patients : 0) },
    { key: "avgTicket", label: "Ticket médio", sub: `Meta: R$ ${goals.avg_ticket_goal}`, value: brl(avgTicket), pct: clamp(avgTicket / (goals.avg_ticket_goal || 1)) },
  ];

  const recent = [...vendas]
    .sort((a, b) => b.sold_at.localeCompare(a.sold_at))
    .slice(0, 8)
    .map((v) => ({ soldAt: v.sold_at, patient: v.cliente_nome ?? "—", procedimentos: v.procedimentos ?? "—", total: Number(v.total) || 0 }));

  return {
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket },
    gauges, months: monthList,
    topProcedures: topProcedures(vendas.map((v) => v.procedimentos), 6),
    recent,
  };
}

function brl(n: number) { return `R$ ${Math.round(n).toLocaleString("pt-BR")}`; }
function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : "—"; }
