import { topProcedures } from "@/lib/procedimentos";
import type { AgendaRow, ClienteRow, Gauge, OverviewSource, ProcCount, RevenuePoint, Timeframe, VendaRow } from "./types";

const TZ = "America/Sao_Paulo";
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" });
const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const monthLabelFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short" });

type ZonedParts = { year: number; month: number; day: number; hour: number };

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  today: "Hoje",
  week: "Semana atual",
  month: "Mês",
  year: "Ano",
};

function zonedParts(date: Date): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

function localDateKey(date: Date): Date {
  const z = zonedParts(date);
  return new Date(Date.UTC(z.year, z.month - 1, z.day));
}

function localHour(date: Date): number {
  return zonedParts(date).hour;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfTimeframe(now: Date, timeframe: Timeframe): Date {
  const current = localDateKey(now);
  if (timeframe === "today") return current;
  if (timeframe === "week") return addDays(current, -((current.getUTCDay() + 6) % 7));
  if (timeframe === "month") return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  return new Date(Date.UTC(current.getUTCFullYear(), 0, 1));
}

function isWithin(date: Date, start: Date, end: Date): boolean {
  return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
}

function rangeDates(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

function monthRange(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function bucketLabel(date: Date, timeframe: Timeframe): string {
  if (timeframe === "today") return `${String(date.getUTCHours()).padStart(2, "0")}h`;
  if (timeframe === "year") {
    const label = monthLabelFmt.format(date).replace(/\.$/, "");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (timeframe === "week") {
    const day = weekdayFmt.format(date).replace(/\.$/, "");
    return `${day.charAt(0).toUpperCase() + day.slice(1)} ${dayMonthFmt.format(date)}`;
  }
  return dayMonthFmt.format(date);
}

function buildBuckets(timeframe: Timeframe, now: Date): RevenuePoint[] {
  const current = localDateKey(now);
  if (timeframe === "today") {
    const hour = localHour(now);
    return Array.from({ length: hour + 1 }, (_, h) => ({
      bucket: `${current.toISOString().slice(0, 10)}-${h}`,
      label: `${String(h).padStart(2, "0")}h`,
      revenue: 0,
      collected: 0,
      sales: 0,
      newPatients: 0,
    }));
  }

  const start = startOfTimeframe(now, timeframe);
  const dates = timeframe === "year" ? monthRange(start, current) : rangeDates(start, current);
  return dates.map((d) => ({
    bucket: timeframe === "year" ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : d.toISOString().slice(0, 10),
    label: bucketLabel(d, timeframe),
    revenue: 0,
    collected: 0,
    sales: 0,
    newPatients: 0,
  }));
}

function bucketForDate(timeframe: Timeframe, date: Date): string {
  if (timeframe === "today") return `${localDateKey(date).toISOString().slice(0, 10)}-${localHour(date)}`;
  const key = localDateKey(date);
  return timeframe === "year" ? `${key.getUTCFullYear()}-${String(key.getUTCMonth() + 1).padStart(2, "0")}` : key.toISOString().slice(0, 10);
}

function filteredSales(source: OverviewSource, timeframe: Timeframe): VendaRow[] {
  const now = new Date(source.nowIso);
  const start = startOfTimeframe(now, timeframe);
  const end = localDateKey(now);
  return source.vendas.filter((v) => isWithin(localDateKey(new Date(v.sold_at)), start, end));
}

function filteredClients(source: OverviewSource, timeframe: Timeframe): ClienteRow[] {
  const now = new Date(source.nowIso);
  const start = startOfTimeframe(now, timeframe);
  const end = localDateKey(now);
  return source.clientes.filter((c) => c.cadastro_at && isWithin(localDateKey(new Date(c.cadastro_at)), start, end));
}

function filteredAgenda(source: OverviewSource, timeframe: Timeframe): AgendaRow[] {
  const now = new Date(source.nowIso);
  const start = startOfTimeframe(now, timeframe);
  const end = localDateKey(now);
  return source.agenda.filter((a) => isWithin(localDateKey(new Date(a.appointment_at)), start, end));
}

function goalForRange(goal: number, timeframe: Timeframe, now: Date): number {
  const current = localDateKey(now);
  const daysInMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0)).getUTCDate();
  if (timeframe === "today") return goal / daysInMonth;
  if (timeframe === "week") return (goal / daysInMonth) * 7;
  if (timeframe === "month") return goal;
  return goal * 12;
}

function brl(n: number) {
  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
}

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}

export function buildOverviewSlice(source: OverviewSource, timeframe: Timeframe) {
  const now = new Date(source.nowIso);
  const vendas = filteredSales(source, timeframe);
  const clientes = filteredClients(source, timeframe);
  const atendimentos = filteredAgenda(source, timeframe).filter((a) => a.pendente === false).length;
  const buckets = buildBuckets(timeframe, now);
  const bucketMap = new Map(buckets.map((b) => [b.bucket, b]));

  for (const v of vendas) {
    const bucket = bucketMap.get(bucketForDate(timeframe, new Date(v.sold_at)));
    if (!bucket) continue;
    bucket.revenue += Number(v.total) || 0;
    bucket.collected += Number(v.valor_pago) || 0;
    bucket.sales += 1;
  }
  for (const c of clientes) {
    if (!c.cadastro_at) continue;
    const bucket = bucketMap.get(bucketForDate(timeframe, new Date(c.cadastro_at)));
    if (!bucket) continue;
    bucket.newPatients += 1;
  }

  const revenueBilled = vendas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const revenueCollected = vendas.reduce((a, v) => a + (Number(v.valor_pago) || 0), 0);
  const sales = vendas.length;
  const buyers = new Set(vendas.map((v) => v.cliente_supabase_id).filter(Boolean)).size;
  const patients = clientes.length;
  const avgTicket = sales ? revenueBilled / sales : 0;
  const revenueGoal = goalForRange(source.goals.monthly_revenue_goal, timeframe, now);
  const newPatientsGoal = goalForRange(source.goals.monthly_new_patient_goal, timeframe, now);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  const gauges: Gauge[] = [
    { key: "revenue", label: "Meta de receita", sub: "No período selecionado", value: brl(revenueBilled), pct: clamp(revenueBilled / (revenueGoal || 1)) },
    { key: "newPatients", label: "Novos pacientes", sub: "No período selecionado", value: String(patients), pct: clamp(patients / (newPatientsGoal || 1)) },
    { key: "conversion", label: "Conversão", sub: "Pacientes que compraram", value: pct(buyers, patients), pct: clamp(patients ? buyers / patients : 0) },
    { key: "avgTicket", label: "Ticket médio", sub: `Meta: R$ ${source.goals.avg_ticket_goal}`, value: brl(avgTicket), pct: clamp(avgTicket / (source.goals.avg_ticket_goal || 1)) },
  ];

  return {
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket, atendimentos },
    gauges,
    chart: buckets,
    topProcedures: topProcedures(vendas.map((v) => v.procedimentos), 6) as ProcCount[],
  };
}
