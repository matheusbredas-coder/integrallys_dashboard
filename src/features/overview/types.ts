export type VendaRow = {
  sold_at: string;
  // gestek data_criacao — the real wall-clock time the sale was registered. sold_at is
  // date-only (local midnight), so the hourly chart buckets by this instead. Optional:
  // null/absent on rows synced before it was exposed → hourly bucketing falls back to sold_at.
  created_at?: string | null;
  cliente_supabase_id: string | null;
  cliente_nome: string | null;
  total: number;
  valor_pago: number;
  valor_desconto: number;
  procedimentos: string | null;
};
export type ClienteRow = { id: string; cadastro_at: string | null };
// Effective appointment outcome from agenda_view. 'agendado' = future/not yet resolved;
// past bookings default to 'realizado' unless an agenda_attendance override says otherwise.
export type AttendanceStatus = "realizado" | "cancelado" | "falta" | "agendado";
export type AgendaRow = { appointment_at: string; status: AttendanceStatus };
export type Goals = { monthly_revenue_goal: number; monthly_new_patient_goal: number; avg_ticket_goal: number };
export type Timeframe = "today" | "week" | "month" | "year";
export type DateRange = { start: Date; end: Date };
export type Granularity = "hour" | "day" | "month";

export type Kpi = {
  revenueBilled: number; revenueCollected: number; outstanding: number;
  patients: number; buyers: number; convertedNewPatients: number; sales: number; avgTicket: number;
  atendimentos: number; cancelados: number; faltas: number;
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
