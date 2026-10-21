import type { DateRange } from "@/features/overview/types";
import type {
  ChartPoint,
  CostByModel,
  CostDaily,
  CostPoint,
  DayKey,
  PageSlice,
  RankedModel,
  RankedPage,
  RankedSlice,
  TrafficDaily,
  TrafficSlice,
  TrafficTotals,
} from "./types";

const dayMonthFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" });

/**
 * A UTC-midnight Date (what `rangeForPreset` and the period picker hand out — they stand in
 * for the clinic's local calendar day) as a "YYYY-MM-DD" key.
 */
export function dayKey(date: Date): DayKey {
  return date.toISOString().slice(0, 10);
}

/** GA4 reports `date` as "20260908". */
export function ga4DateToKey(raw: string): DayKey {
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** The Admin API stamps each bucket with an RFC 3339 `starting_at`. */
export function isoToKey(iso: string): DayKey {
  return iso.slice(0, 10);
}

/**
 * Both range ends are inclusive, matching the period picker: picking a single day gives
 * `{ start: d, end: d }` and must return that day's rows, not none.
 */
export function inRange(key: DayKey, range: DateRange): boolean {
  return key >= dayKey(range.start) && key <= dayKey(range.end);
}

export function sumTraffic(daily: TrafficDaily[], range: DateRange): TrafficTotals {
  return daily.reduce<TrafficTotals>(
    (acc, row) => {
      if (!inRange(row.date, range)) return acc;
      acc.sessions += row.sessions;
      acc.users += row.users;
      acc.views += row.views;
      return acc;
    },
    { sessions: 0, users: 0, views: 0 }
  );
}

/**
 * Users are summed across days on purpose, and that is NOT the same as unique visitors for
 * the period — someone who came back on Tuesday is counted twice. GA4 can only de-duplicate
 * a range it was asked about, and the page slices client-side from a fixed 90-day pull, so
 * the honest reading of this number is "visits by day, added up". The label says "visitas".
 */
export function buildChart(daily: TrafficDaily[], range: DateRange): ChartPoint[] {
  return daily
    .filter((row) => inRange(row.date, range))
    .map((row) => ({
      date: row.date,
      label: dayMonthFmt.format(new Date(`${row.date}T00:00:00Z`)),
      sessions: row.sessions,
      users: row.users,
    }));
}

function rank(rows: TrafficSlice[], range: DateRange, label: (key: string) => string): RankedSlice[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    totals.set(row.key, (totals.get(row.key) ?? 0) + row.sessions);
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([key, sessions]) => ({ key, label: label(key), sessions, share: sum > 0 ? (sessions / sum) * 100 : 0 }))
    .sort((a, b) => b.sessions - a.sessions);
}

export function rankChannels(rows: TrafficSlice[], range: DateRange): RankedSlice[] {
  return rank(rows, range, channelLabel);
}

export function rankDevices(rows: TrafficSlice[], range: DateRange): RankedSlice[] {
  return rank(rows, range, deviceLabel);
}

export function topPages(rows: PageSlice[], range: DateRange, limit = 8): RankedPage[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    totals.set(row.path, (totals.get(row.path) ?? 0) + row.views);
  }
  return [...totals.entries()]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, limit);
}

/**
 * GA4's default channel grouping, in Portuguese. Anything Google adds later falls through
 * with its own name rather than being hidden — an unmapped channel is still real traffic.
 */
const CHANNEL_LABELS: Record<string, string> = {
  "Direct": "Direto",
  "Organic Search": "Busca orgânica",
  "Paid Search": "Busca paga",
  "Organic Social": "Social orgânico",
  "Paid Social": "Social pago",
  "Organic Video": "Vídeo orgânico",
  "Paid Video": "Vídeo pago",
  "Display": "Display",
  "Referral": "Indicação",
  "Email": "E-mail",
  "Affiliates": "Afiliados",
  "Audio": "Áudio",
  "SMS": "SMS",
  "Mobile Push Notifications": "Notificações",
  "Paid Other": "Outros pagos",
  "Organic Shopping": "Compras orgânico",
  "Paid Shopping": "Compras pago",
  "Cross-network": "Entre redes",
  "Unassigned": "Não identificado",
};

export function channelLabel(key: string): string {
  return CHANNEL_LABELS[key] ?? key;
}

const DEVICE_LABELS: Record<string, string> = {
  desktop: "Computador",
  mobile: "Celular",
  tablet: "Tablet",
  smarttv: "TV",
};

export function deviceLabel(key: string): string {
  return DEVICE_LABELS[key.toLowerCase()] ?? key;
}

/**
 * The Admin API returns money as a decimal string in the currency's lowest unit — "123.45"
 * in USD is $1.2345, not $123.45. Getting this backwards inflates the bill 100x, so the
 * conversion lives in one place and is tested.
 */
export function centsToUsd(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined) return 0;
  const n = typeof amount === "number" ? amount : Number(amount);
  return Number.isFinite(n) ? n / 100 : 0;
}

export function sumCost(daily: CostDaily[], range: DateRange): number {
  return daily.reduce((acc, row) => (inRange(row.date, range) ? acc + row.usd : acc), 0);
}

export function buildCostChart(daily: CostDaily[], range: DateRange): CostPoint[] {
  return daily
    .filter((row) => inRange(row.date, range))
    .map((row) => ({
      date: row.date,
      label: dayMonthFmt.format(new Date(`${row.date}T00:00:00Z`)),
      usd: row.usd,
    }));
}

export function rankModels(rows: CostByModel[], range: DateRange): RankedModel[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (!inRange(row.date, range)) continue;
    totals.set(row.model, (totals.get(row.model) ?? 0) + row.usd);
  }
  const sum = [...totals.values()].reduce((a, b) => a + b, 0);
  return [...totals.entries()]
    .map(([model, usd]) => ({ model, usd, share: sum > 0 ? (usd / sum) * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);
}

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

/** Spend is billed in dollars, so it is shown in dollars — converting to BRL here would
 *  invent an exchange rate the invoice never used. */
export function formatUsd(value: number): string {
  return usd.format(value).replace(/ /g, " ");
}
