/** A calendar day as "YYYY-MM-DD". Both sources are normalized to this so the client can
 *  slice a period with a plain string compare instead of re-parsing dates on every render. */
export type DayKey = string;

export type TrafficDaily = { date: DayKey; sessions: number; users: number; views: number };
/** One day of one breakdown bucket (a channel, a device). Kept per-day rather than
 *  pre-aggregated so any period the picker produces can be summed on the client. */
export type TrafficSlice = { date: DayKey; key: string; sessions: number };
export type PageSlice = { date: DayKey; path: string; views: number };

export type TrafficSource = {
  daily: TrafficDaily[];
  channels: TrafficSlice[];
  devices: TrafficSlice[];
  pages: PageSlice[];
};

export type CostDaily = { date: DayKey; usd: number };
export type CostByModel = { date: DayKey; model: string; usd: number };
export type CostSource = { daily: CostDaily[]; byModel: CostByModel[] };

/**
 * One panel's worth of data, or the reason it isn't there. The two sources use unrelated
 * credentials, so a stale GA4 key must not blank out the Claude spend and vice versa —
 * `data.ts` resolves them independently and the panel renders whichever arrived.
 */
export type Block<T> = { ok: true; data: T } | { ok: false; error: string };

export type AnaliseSource = {
  nowIso: string;
  traffic: Block<TrafficSource>;
  cost: Block<CostSource>;
};

/** Totals for a period, as shown in the cards above each chart. */
export type TrafficTotals = { sessions: number; users: number; views: number };
export type RankedSlice = { key: string; label: string; sessions: number; share: number };
export type RankedPage = { path: string; views: number };
export type ChartPoint = { date: DayKey; label: string; sessions: number; users: number };
export type CostPoint = { date: DayKey; label: string; usd: number };
export type RankedModel = { model: string; usd: number; share: number };
