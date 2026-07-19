import { topProcedures } from "@/lib/procedimentos";
import type { AgendaRow, ClienteRow, DateRange, Gauge, Granularity, OverviewSource, ProcCount, RecentSale, RevenuePoint, Timeframe, VendaRow } from "./types";

const TZ = "America/Sao_Paulo";
const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", weekday: "short" });
const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const monthLabelFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "short" });

const DAY_MS = 86_400_000;

type ZonedParts = { year: number; month: number; day: number; hour: number };

// Trigger label shown when a quick preset is the active selection.
export const PRESET_LABELS: Record<Timeframe, string> = {
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

// A UTC-midnight Date standing in for the clinic's local calendar day.
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

// Build a {start, end} day range for a quick preset. End stays "up to today" so the
// presets keep matching what the dashboard previously showed.
export function rangeForPreset(now: Date, preset: Timeframe): DateRange {
  const current = localDateKey(now);
  if (preset === "today") return { start: current, end: current };
  if (preset === "week") return { start: addDays(current, -((current.getUTCDay() + 6) % 7)), end: current };
  if (preset === "month") return { start: new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)), end: current };
  return { start: new Date(Date.UTC(current.getUTCFullYear(), 0, 1)), end: current };
}

// Inclusive count of local days covered by the range (start/end are UTC-midnight keys).
function dayCount(range: DateRange): number {
  return Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS) + 1;
}

// Pick chart granularity from the span: a single day → hourly, up to a quarter → daily,
// anything longer → monthly.
export function deriveGranularity(range: DateRange): Granularity {
  if (range.start.getTime() === range.end.getTime()) return "hour";
  return dayCount(range) <= 92 ? "day" : "month";
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

function bucketLabel(date: Date, granularity: Granularity, showWeekday: boolean): string {
  if (granularity === "hour") return `${String(date.getUTCHours()).padStart(2, "0")}h`;
  if (granularity === "month") {
    const label = monthLabelFmt.format(date).replace(/\.$/, "");
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  if (showWeekday) {
    const day = weekdayFmt.format(date).replace(/\.$/, "");
    return `${day.charAt(0).toUpperCase() + day.slice(1)} ${dayMonthFmt.format(date)}`;
  }
  return dayMonthFmt.format(date);
}

function buildBuckets(range: DateRange, granularity: Granularity, now: Date): RevenuePoint[] {
  if (granularity === "hour") {
    const day = range.start;
    const isToday = day.getTime() === localDateKey(now).getTime();
    const lastHour = isToday ? localHour(now) : 23;
    return Array.from({ length: lastHour + 1 }, (_, h) => ({
      bucket: `${day.toISOString().slice(0, 10)}-${h}`,
      label: `${String(h).padStart(2, "0")}h`,
      revenue: 0,
      collected: 0,
      sales: 0,
      newPatients: 0,
    }));
  }

  const dates = granularity === "month" ? monthRange(range.start, range.end) : rangeDates(range.start, range.end);
  const showWeekday = granularity === "day" && dates.length <= 8;
  return dates.map((d) => ({
    bucket: granularity === "month" ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` : d.toISOString().slice(0, 10),
    label: bucketLabel(d, granularity, showWeekday),
    revenue: 0,
    collected: 0,
    sales: 0,
    newPatients: 0,
  }));
}

function bucketForDate(granularity: Granularity, date: Date): string {
  if (granularity === "hour") return `${localDateKey(date).toISOString().slice(0, 10)}-${localHour(date)}`;
  const key = localDateKey(date);
  return granularity === "month" ? `${key.getUTCFullYear()}-${String(key.getUTCMonth() + 1).padStart(2, "0")}` : key.toISOString().slice(0, 10);
}

// Bucket key for a sale. sold_at is date-only (local midnight), so the hourly chart
// would dump every sale into 00h; use created_at (registration time) for the hour while
// keeping the day from sold_at so it still lands in the selected day's buckets. Falls
// back to sold_at when created_at is absent (rows synced before it was exposed).
function bucketForSale(granularity: Granularity, v: VendaRow): string {
  if (granularity === "hour") {
    const day = localDateKey(new Date(v.sold_at)).toISOString().slice(0, 10);
    return `${day}-${localHour(new Date(v.created_at ?? v.sold_at))}`;
  }
  return bucketForDate(granularity, new Date(v.sold_at));
}

function filteredSales(source: OverviewSource, range: DateRange): VendaRow[] {
  return source.vendas.filter((v) => isWithin(localDateKey(new Date(v.sold_at)), range.start, range.end));
}

function filteredClients(source: OverviewSource, range: DateRange): ClienteRow[] {
  return source.clientes.filter((c) => c.cadastro_at && isWithin(localDateKey(new Date(c.cadastro_at)), range.start, range.end));
}

function filteredAgenda(source: OverviewSource, range: DateRange): AgendaRow[] {
  return source.agenda.filter((a) => isWithin(localDateKey(new Date(a.appointment_at)), range.start, range.end));
}

// Prorate a monthly goal to the range by its inclusive day count.
function goalForRange(goal: number, range: DateRange): number {
  const daysInMonth = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() + 1, 0)).getUTCDate();
  return (goal / daysInMonth) * dayCount(range);
}

// Returns the goal for a named preset period; rounds up daily/weekly to the nearest R$ 100.
function goalForTimeframe(monthly: number, timeframe: Timeframe | null | undefined, range: DateRange): number {
  if (timeframe === "today") return Math.ceil(monthly / 30 / 100) * 100;
  if (timeframe === "week") return Math.ceil((monthly / 30) * 7 / 100) * 100;
  if (timeframe === "month") return monthly;
  if (timeframe === "year") return monthly * 12;
  return goalForRange(monthly, range);
}

// Compact pt-BR label for the trigger button, e.g. "01/06" or "01/06 – 05/06".
export function formatRangeLabel(range: DateRange): string {
  if (range.start.getTime() === range.end.getTime()) return dayMonthFmt.format(range.start);
  return `${dayMonthFmt.format(range.start)} – ${dayMonthFmt.format(range.end)}`;
}

function brl(n: number) {
  return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
}

export function buildOverviewSlice(source: OverviewSource, range: DateRange, timeframe?: Timeframe | null) {
  const now = new Date(source.nowIso);
  const granularity = deriveGranularity(range);
  const vendas = filteredSales(source, range);
  const clientes = filteredClients(source, range);
  const agenda = filteredAgenda(source, range);
  const atendimentos = agenda.filter((a) => a.status === "realizado").length;
  const cancelados = agenda.filter((a) => a.status === "cancelado").length;
  const faltas = agenda.filter((a) => a.status === "falta").length;
  const buckets = buildBuckets(range, granularity, now);
  const bucketMap = new Map(buckets.map((b) => [b.bucket, b]));

  for (const v of vendas) {
    const bucket = bucketMap.get(bucketForSale(granularity, v));
    if (!bucket) continue;
    bucket.revenue += Number(v.total) || 0;
    bucket.collected += Number(v.valor_pago) || 0;
    bucket.sales += 1;
  }
  for (const c of clientes) {
    if (!c.cadastro_at) continue;
    const bucket = bucketMap.get(bucketForDate(granularity, new Date(c.cadastro_at)));
    if (!bucket) continue;
    bucket.newPatients += 1;
  }

  const revenueBilled = vendas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const discountsGiven = vendas.reduce((a, v) => a + (Number(v.valor_desconto) || 0), 0);
  const gross = revenueBilled + discountsGiven; // faturamento bruto (subtotal)
  const revenueCollected = vendas.reduce((a, v) => a + (Number(v.valor_pago) || 0), 0);
  const sales = vendas.length;
  const buyerIds = new Set(vendas.map((v) => v.cliente_supabase_id).filter(Boolean));
  const buyers = buyerIds.size;
  const patients = clientes.length;
  // New-patient conversion: of patients registered in this period, how many also made a
  // sale in this period. Drives "Taxa de conversão" — a new-patient funnel, not sales/atendimentos.
  const convertedNewPatients = clientes.filter((c) => buyerIds.has(c.id)).length;
  const avgTicket = sales ? revenueBilled / sales : 0;
  const revenueGoal = goalForTimeframe(source.goals.monthly_revenue_goal, timeframe, range);
  const clamp = (n: number) => Math.max(0, Math.min(1, n));

  // Atendimentos gauge: value is the realized count; the ring is the comparecimento rate
  // (realized share of resolved bookings) — future (agendado) bookings are excluded.
  const resolved = atendimentos + cancelados + faltas;

  const gauges: Gauge[] = [
    { key: "revenue", label: "Meta de receita", sub: `Meta: ${brl(revenueGoal)}`, value: brl(revenueGoal), pct: clamp(revenueBilled / (revenueGoal || 1)) },
    { key: "attendance", label: "Atendimentos", sub: "Comparecimento no período", value: String(atendimentos), pct: clamp(resolved ? atendimentos / resolved : 0) },
    { key: "discounts", label: "Descontos", sub: "% do faturamento bruto", value: brl(discountsGiven), pct: clamp(gross ? discountsGiven / gross : 0) },
    { key: "avgTicket", label: "Ticket médio", sub: `Meta: R$ ${source.goals.avg_ticket_goal}`, value: brl(avgTicket), pct: clamp(avgTicket / (source.goals.avg_ticket_goal || 1)) },
  ];

  const recentSales: RecentSale[] = [...vendas]
    .sort((a, b) => String(b.sold_at).localeCompare(String(a.sold_at)))
    .slice(0, 8)
    .map((v) => ({ soldAt: String(v.sold_at), patient: v.cliente_nome ?? "—", procedimentos: v.procedimentos ?? "—", total: Number(v.total) || 0 }));

  return {
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, convertedNewPatients, sales, avgTicket, atendimentos, cancelados, faltas },
    gauges,
    chart: buckets,
    topProcedures: topProcedures(vendas.map((v) => v.procedimentos), 6) as ProcCount[],
    recentSales,
  };
}

// Calendar-grid helper for the period picker: the local "today" key and the UTC-midnight
// first-of-month for an arbitrary month, so the popup can reuse the same day arithmetic.
export function todayKey(now = new Date()): Date {
  return localDateKey(now);
}

export function firstOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export { addDays as addDaysUTC };
