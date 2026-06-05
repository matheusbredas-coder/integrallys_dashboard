export type VendaRow = {
  sold_at: string;
  cliente_supabase_id: string | null;
  cliente_nome: string | null;
  total: number;
  valor_pago: number;
  procedimentos: string | null;
};
export type ClienteRow = { id: string; cadastro_at: string | null; numero_vendas: number };
export type AgendaRow = { appointment_at: string; pendente: boolean };
export type Goals = { monthly_revenue_goal: number; monthly_new_patient_goal: number; avg_ticket_goal: number };
export type Timeframe = "today" | "week" | "month" | "year";

export type Kpi = {
  revenueBilled: number; revenueCollected: number; outstanding: number;
  patients: number; buyers: number; sales: number; avgTicket: number; atendimentos: number;
};
export type Gauge = { key: string; label: string; sub: string; value: string; pct: number };
export type MonthPoint = { month: string; revenue: number; collected: number; sales: number; newPatients: number };
export type RecentSale = { soldAt: string; patient: string; procedimentos: string; total: number };
export type ProcCount = { name: string; qty: number };
export type RevenuePoint = { bucket: string; label: string; revenue: number; collected: number; sales: number; newPatients: number };
export type OverviewSource = { vendas: VendaRow[]; clientes: ClienteRow[]; agenda: AgendaRow[]; goals: Goals; recent: RecentSale[]; nowIso: string };
export type OverviewData = {
  kpi: Kpi; gauges: Gauge[]; months: MonthPoint[]; topProcedures: ProcCount[]; recent: RecentSale[];
};
