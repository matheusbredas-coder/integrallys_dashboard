# Integrallys CRM — Plan 2: Overview Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the premium Overview dashboard on live data — KPIs, gold gauges, a monthly revenue chart, recent-sales feed, and top procedures — sourced from `gestek_vendas` (dated sales) + `clientes_view`.

**Architecture:** A pure, unit-tested aggregation layer (`computeOverview`) turns raw rows into a typed `OverviewData`. A server data module fetches from Supabase (service client) and calls it. Server components render KPI/gauge/list tiles; Recharts client components render charts. All styling uses the Plan 1 gold/matte theme tokens.

**Tech Stack:** Next.js 16 (App Router, server components), TypeScript, Recharts, Vitest, Supabase service client.

**Builds on Plan 1:** `src/lib/format.ts` (formatBRL/formatInt/parseGestekDate), `src/lib/supabase/server.ts` (`createSupabaseServiceClient`), theme `.card`/tokens in `globals.css`, the `(app)` shell.

---

## Real-data facts (design is built on these)
- `gestek_vendas`: 838 rows, **all `status=1`**. Revenue **billed = Σ`total` ≈ R$424k**, **collected = Σ`valor_pago` ≈ R$408k**. Date range **2025-07 → 2026-06**.
- `clientes_view`: 337 patients, **271 buyers** (reconciles with vendas). `cadastro_at` present for all.
- Headline revenue = **billed (`total`)**; also show collected + outstanding.
- **Dropped** (monolithic): by-origin, by-professional. **No** standalone Sales page (patient detail covers per-patient sales in Plan 3).
- Goals in `app_settings`: `monthly_revenue_goal=65000`, `monthly_new_patient_goal=30`, `avg_ticket_goal=280`.

## File structure
```
db/migrations/006_vendas_view.sql              ← typed status=1 sales view
db/migrations/007_vendas_monthly.sql           ← month → sales/billed/collected
src/lib/procedimentos.ts                       ← robust procedure parser (TDD)
src/lib/procedimentos.test.ts
src/features/overview/types.ts                 ← OverviewData contracts
src/features/overview/aggregate.ts             ← pure computeOverview (TDD)
src/features/overview/aggregate.test.ts
src/features/overview/data.ts                  ← server fetch → computeOverview
src/features/overview/kpi-cards.tsx            ← 4 KPI tiles (server)
src/features/overview/gauges.tsx               ← 4 conic-ring gauges (server)
src/features/overview/revenue-chart.tsx        ← Recharts monthly chart (client)
src/features/overview/recent-sales.tsx         ← last 8 sales feed (server)
src/features/overview/top-procedures.tsx       ← ranked procedures (server)
src/features/overview/ask-bar.tsx              ← chat entry (visual stub; wired in Plan 4)
src/app/(app)/page.tsx                         ← assembles the Overview (replaces placeholder)
```

---

## Task 1: SQL views for sales

**Files:** Create `db/migrations/006_vendas_view.sql`, `db/migrations/007_vendas_monthly.sql`

- [ ] **Step 1: Write `006_vendas_view.sql`**
```sql
-- Typed, completed-sales view over gestek_vendas (status = 1).
create or replace view public.vendas_view as
select
  v.id,
  v.codigo,
  (v.data)::timestamptz                                    as sold_at,
  (date_trunc('month', (v.data)::timestamptz))::date       as sold_month,
  v.cliente_supabase_id,
  v.cliente                                                as cliente_nome,
  v.status,
  v.procedimentos,
  coalesce(v.subtotal, 0)::numeric                         as subtotal,
  coalesce(v.total, 0)::numeric                            as total,
  coalesce(v.valor_pago, 0)::numeric                       as valor_pago,
  coalesce(v.desconto, 0)::numeric                         as desconto,
  v.profissional
from public.gestek_vendas v
where v.status = 1;

grant select on public.vendas_view to anon, authenticated, service_role;
```

- [ ] **Step 2: Write `007_vendas_monthly.sql`**
```sql
-- Monthly rollup for charts and the future AI.
create or replace view public.vendas_monthly as
select
  (date_trunc('month', (data)::timestamptz))::date as month,
  count(*)                                          as sales,
  sum(coalesce(total, 0))::numeric                  as revenue_billed,
  sum(coalesce(valor_pago, 0))::numeric             as revenue_collected
from public.gestek_vendas
where status = 1
group by 1
order by 1;

grant select on public.vendas_monthly to anon, authenticated, service_role;
```

- [ ] **Step 3: Apply both in Supabase SQL Editor.** (Controller will hand the SQL to the user to run, then verify via the service client.)

- [ ] **Step 4: Verify** (controller, via service client): `vendas_view` returns 838 rows; `vendas_monthly` returns ~12 month rows with revenue_billed totalling ≈ 424039.

- [ ] **Step 5: Commit**
```bash
git add db/migrations/006_vendas_view.sql db/migrations/007_vendas_monthly.sql
git commit -m "feat: vendas_view + vendas_monthly sql views"
```

---

## Task 2: Procedure parser (TDD)

**Files:** Create `src/lib/procedimentos.ts`, Test `src/lib/procedimentos.test.ts`

- [ ] **Step 1: Write the failing test** `src/lib/procedimentos.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { parseProcedimentos, topProcedures } from "./procedimentos";

describe("parseProcedimentos", () => {
  it("parses simple items", () => {
    expect(parseProcedimentos("BOTOX (2), MICROAGULHAMENTO (1)")).toEqual([
      { name: "BOTOX", qty: 2 },
      { name: "MICROAGULHAMENTO", qty: 1 },
    ]);
  });
  it("keeps commas inside names (dosages)", () => {
    expect(parseProcedimentos("MONJAURO 2,5 MG (3)")).toEqual([{ name: "MONJAURO 2,5 MG", qty: 3 }]);
  });
  it("keeps parentheses inside names", () => {
    expect(parseProcedimentos("MONJAURO 2,5 MG (PROMOCIONAL) (1)")).toEqual([
      { name: "MONJAURO 2,5 MG (PROMOCIONAL)", qty: 1 },
    ]);
  });
  it("handles null/empty", () => {
    expect(parseProcedimentos(null)).toEqual([]);
    expect(parseProcedimentos("")).toEqual([]);
  });
});

describe("topProcedures", () => {
  it("sums quantities across rows and ranks", () => {
    const rows = ["BOTOX (2)", "BOTOX (1), MONJAURO 5,0 MG (4)"];
    expect(topProcedures(rows, 2)).toEqual([
      { name: "MONJAURO 5,0 MG", qty: 4 },
      { name: "BOTOX", qty: 3 },
    ]);
  });
});
```

- [ ] **Step 2: Run → fail** `npm test` (module missing).

- [ ] **Step 3: Implement** `src/lib/procedimentos.ts`
```ts
export type Procedure = { name: string; qty: number };

// Items are separated by ", " but names may contain commas (e.g. "2,5 MG") and
// parentheses (e.g. "(PROMOCIONAL)"). The count is the trailing "(N)" of each item.
const ITEM_RE = /(.+?)\((\d+)\)(?=\s*,|\s*$)/g;

export function parseProcedimentos(raw: string | null | undefined): Procedure[] {
  if (!raw) return [];
  const out: Procedure[] = [];
  ITEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM_RE.exec(raw)) !== null) {
    const name = m[1].replace(/^[\s,]+/, "").trim();
    const qty = parseInt(m[2], 10);
    if (name) out.push({ name, qty });
  }
  return out;
}

export function topProcedures(rows: (string | null | undefined)[], limit = 6): Procedure[] {
  const totals = new Map<string, number>();
  for (const r of rows) for (const p of parseProcedimentos(r)) totals.set(p.name, (totals.get(p.name) ?? 0) + p.qty);
  return [...totals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
}
```

- [ ] **Step 4: Run → pass** `npm test`.

- [ ] **Step 5: Commit** `git add src/lib/procedimentos.* && git commit -m "feat: robust procedimentos parser (TDD)"`

---

## Task 3: Overview types + aggregation (TDD)

**Files:** Create `src/features/overview/types.ts`, `src/features/overview/aggregate.ts`, Test `src/features/overview/aggregate.test.ts`

- [ ] **Step 1: Write `src/features/overview/types.ts`**
```ts
export type VendaRow = {
  sold_at: string;            // ISO
  cliente_supabase_id: string | null;
  cliente_nome: string | null;
  total: number;
  valor_pago: number;
  procedimentos: string | null;
};
export type ClienteRow = { id: string; cadastro_at: string | null };
export type Goals = { monthly_revenue_goal: number; monthly_new_patient_goal: number; avg_ticket_goal: number };

export type Kpi = {
  revenueBilled: number; revenueCollected: number; outstanding: number;
  patients: number; buyers: number; sales: number; avgTicket: number;
};
export type Gauge = { key: string; label: string; sub: string; value: string; pct: number };
export type MonthPoint = { month: string; revenue: number; collected: number; sales: number; newPatients: number };
export type RecentSale = { soldAt: string; patient: string; procedimentos: string; total: number };
export type ProcCount = { name: string; qty: number };
export type OverviewData = {
  kpi: Kpi; gauges: Gauge[]; months: MonthPoint[]; topProcedures: ProcCount[]; recent: RecentSale[];
};
```

- [ ] **Step 2: Write the failing test** `src/features/overview/aggregate.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { computeOverview } from "./aggregate";
import type { VendaRow, ClienteRow, Goals } from "./types";

const goals: Goals = { monthly_revenue_goal: 1000, monthly_new_patient_goal: 4, avg_ticket_goal: 100 };
const vendas: VendaRow[] = [
  { sold_at: "2026-05-02T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 200, valor_pago: 150, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-06-01T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, procedimentos: "MONJAURO 2,5 MG (2)" },
];
const clientes: ClienteRow[] = [
  { id: "1", cadastro_at: "2026-05-01T00:00:00Z" },
  { id: "2", cadastro_at: "2026-06-01T00:00:00Z" },
  { id: "3", cadastro_at: "2026-06-02T00:00:00Z" }, // non-buyer
];
const NOW = new Date("2026-06-15T00:00:00Z");

describe("computeOverview", () => {
  const d = computeOverview(vendas, clientes, goals, NOW);

  it("computes KPIs", () => {
    expect(d.kpi.revenueBilled).toBe(1000);
    expect(d.kpi.revenueCollected).toBe(950);
    expect(d.kpi.outstanding).toBe(50);
    expect(d.kpi.patients).toBe(3);
    expect(d.kpi.buyers).toBe(2);
    expect(d.kpi.sales).toBe(3);
    expect(d.kpi.avgTicket).toBeCloseTo(1000 / 3);
  });

  it("builds a sorted monthly series with new patients", () => {
    expect(d.months.map((m) => m.month)).toEqual(["2026-05", "2026-06"]);
    expect(d.months[0]).toMatchObject({ revenue: 500, sales: 2, newPatients: 1 });
    expect(d.months[1]).toMatchObject({ revenue: 500, sales: 1, newPatients: 2 });
  });

  it("gauges: revenue-this-month vs goal + conversion", () => {
    const rev = d.gauges.find((g) => g.key === "revenue")!;
    expect(rev.pct).toBeCloseTo(0.5); // June revenue 500 / goal 1000
    const conv = d.gauges.find((g) => g.key === "conversion")!;
    expect(conv.pct).toBeCloseTo(2 / 3); // 2 buyers / 3 patients
  });

  it("top procedures + recent (most-recent first)", () => {
    expect(d.topProcedures[0]).toEqual({ name: "MONJAURO 2,5 MG", qty: 2 });
    expect(d.recent[0].patient).toBe("BIA");
  });
});
```

- [ ] **Step 3: Run → fail** `npm test`.

- [ ] **Step 4: Implement** `src/features/overview/aggregate.ts`
```ts
import { topProcedures } from "@/lib/procedimentos";
import type { VendaRow, ClienteRow, Goals, OverviewData, MonthPoint, Gauge } from "./types";

const ym = (iso: string) => iso.slice(0, 7); // "YYYY-MM"

export function computeOverview(vendas: VendaRow[], clientes: ClienteRow[], goals: Goals, now: Date): OverviewData {
  const revenueBilled = vendas.reduce((a, v) => a + (Number(v.total) || 0), 0);
  const revenueCollected = vendas.reduce((a, v) => a + (Number(v.valor_pago) || 0), 0);
  const sales = vendas.length;
  const buyers = new Set(vendas.map((v) => v.cliente_supabase_id).filter(Boolean)).size;
  const patients = clientes.length;

  // monthly buckets (union of sales months + cadastro months)
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
    { key: "revenue", label: "Revenue goal", sub: "This month vs goal", value: brl(tm?.revenue ?? 0), pct: clamp((tm?.revenue ?? 0) / (goals.monthly_revenue_goal || 1)) },
    { key: "newPatients", label: "New patients", sub: "This month vs target", value: String(tm?.newPatients ?? 0), pct: clamp((tm?.newPatients ?? 0) / (goals.monthly_new_patient_goal || 1)) },
    { key: "conversion", label: "Conversion", sub: "Patients who bought", value: pct(buyers, patients), pct: clamp(patients ? buyers / patients : 0) },
    { key: "avgTicket", label: "Avg ticket", sub: `vs R$ ${goals.avg_ticket_goal} goal`, value: brl(avgTicket), pct: clamp(avgTicket / (goals.avg_ticket_goal || 1)) },
  ];

  const recent = [...vendas]
    .sort((a, b) => b.sold_at.localeCompare(a.sold_at))
    .slice(0, 8)
    .map((v) => ({ soldAt: v.sold_at, patient: v.cliente_nome ?? "—", procedimentos: v.procedimentos ?? "—", total: Number(v.total) || 0 }));

  return {
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket },
    gauges,
    months: monthList,
    topProcedures: topProcedures(vendas.map((v) => v.procedimentos), 6),
    recent,
  };
}

function brl(n: number) { return `R$ ${Math.round(n).toLocaleString("pt-BR")}`; }
function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : "—"; }
```

- [ ] **Step 5: Run → pass** `npm test`.

- [ ] **Step 6: Commit** `git add src/features/overview/types.ts src/features/overview/aggregate.* && git commit -m "feat: overview aggregation (TDD)"`

---

## Task 4: Server data fetch

**Files:** Create `src/features/overview/data.ts`

- [ ] **Step 1: Implement** `src/features/overview/data.ts`
```ts
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
```
> Install the tiny `server-only` guard if not present: `npm i server-only`.

- [ ] **Step 2: Verify build** `npx tsc --noEmit` → no errors. Commit.
```bash
git add src/features/overview/data.ts package.json package-lock.json
git commit -m "feat: overview server data fetch"
```

---

## Task 5: KPI cards + gauge tiles (server components)

**Files:** Create `src/features/overview/kpi-cards.tsx`, `src/features/overview/gauges.tsx`

Use the Plan 1 `.card` class + theme tokens (`--gold`, `--muted`, etc.). KPI grid = 4 columns; gauge grid = 2×2 or 4 columns. Match the approved gold mockup (faded cards, big numerals, conic-ring gauges).

- [ ] **Step 1: `kpi-cards.tsx`** — renders 4 tiles from `Kpi`: Revenue (billed) with `formatBRL`, sub "collected {collected} · {outstanding} open"; Patients with sub "{buyers} buyers"; Sales; Avg ticket. Each tile: `<div className="card" style={{padding:24}}>` with uppercase muted label, 32px/700 value, 12px muted sub. Use `formatBRL`/`formatInt` from `@/lib/format`.

- [ ] **Step 2: `gauges.tsx`** — renders 4 `Gauge` tiles. Ring = a 96px circle with `background: conic-gradient(var(--gold) calc(pct*360deg), #26262b 0)` and an inner 74px `#141416` disc showing `Math.round(pct*100)%`. Left side: `label` (16px/700), `sub` (12px muted), `value` (22px/700). Selected/first tile gets a gold border. Reuse the markup from the approved mockup (`.superpowers/brainstorm/.../premium-gold.html`).

- [ ] **Step 3: Verify** `npx tsc --noEmit`. Commit `feat: overview KPI + gauge tiles`.

---

## Task 6: Charts + feed + procedures

**Files:** Create `src/features/overview/revenue-chart.tsx` (client), `src/features/overview/recent-sales.tsx`, `src/features/overview/top-procedures.tsx`

- [ ] **Step 1: `revenue-chart.tsx`** (`"use client"`) — Recharts `ComposedChart` over `MonthPoint[]`: gold gradient `Bar` for `revenue` (billed) + a muted `Line` for `collected`; X axis = month (format `YYYY-MM`→`MMM`), tooltip in BRL, dark theme (transparent bg, `--muted` ticks, grid `#26262b`). Height ~260. Title "Monthly revenue".
```tsx
"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import type { MonthPoint } from "./types";
export function RevenueChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Monthly revenue</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f0d488" /><stop offset="100%" stopColor="#9a7b2e" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26262b" vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m) => m.slice(5)} stroke="#8c8c95" fontSize={11} />
          <YAxis stroke="#8c8c95" fontSize={11} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={{ background: "#141416", border: "1px solid #26262b", borderRadius: 12 }}
            formatter={(v: number) => `R$ ${Math.round(v).toLocaleString("pt-BR")}`} />
          <Bar dataKey="revenue" radius={[6, 6, 2, 2]} fill="url(#gold)" />
          <Line dataKey="collected" stroke="#74cfc0" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: `recent-sales.tsx`** (server) — last 8 `RecentSale`: each row shows `formatDate(parseGestekDate?...)` — note `soldAt` is ISO, so format with `new Date(soldAt)` → `DD/MM`; patient name (bold), truncated procedimentos (muted), `formatBRL(total)` right-aligned gold. Title "Recent sales".

- [ ] **Step 3: `top-procedures.tsx`** (server) — ranked `ProcCount[]` list: name (truncate) + qty bold. Title "Top procedures".

- [ ] **Step 4: Verify** `npx tsc --noEmit && npm run build` (disable sandbox — fonts). Commit `feat: overview charts, recent sales, top procedures`.

---

## Task 7: Assemble the Overview page + Ask bar; live verify

**Files:** Create `src/features/overview/ask-bar.tsx`; Modify `src/app/(app)/page.tsx`

- [ ] **Step 1: `ask-bar.tsx`** — the top "Ask anything about your clinic…" bar (visual only this plan; opens nothing yet — wired in Plan 4). Style per mockup (panel bg, rounded 16, gold "AI ✦" chip, hover gold border).

- [ ] **Step 2: Rewrite `src/app/(app)/page.tsx`** as an async server component:
```tsx
import { getOverviewData } from "@/features/overview/data";
import { AskBar } from "@/features/overview/ask-bar";
import { KpiCards } from "@/features/overview/kpi-cards";
import { Gauges } from "@/features/overview/gauges";
import { RevenueChart } from "@/features/overview/revenue-chart";
import { RecentSales } from "@/features/overview/recent-sales";
import { TopProcedures } from "@/features/overview/top-procedures";

export default async function OverviewPage() {
  const d = await getOverviewData();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <AskBar />
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Hello, Matheus</h1>
        <p className="muted" style={{ marginTop: 4 }}>Here's your clinic at a glance.</p>
      </div>
      <KpiCards kpi={d.kpi} />
      <Gauges gauges={d.gauges} />
      <RevenueChart data={d.months} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <RecentSales rows={d.recent} />
        <TopProcedures rows={d.topProcedures} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Full test + build** `npm test && npm run build` (disable sandbox). Expected: green.

- [ ] **Step 4: Live verify (controller, webapp-testing/Playwright):** log in, screenshot `/`. Confirm: KPI values (Revenue ≈ R$424k, Patients 337, Sales 838, Avg ≈ R$506), 4 gauges render with rings, monthly revenue chart shows the Jul'25→Jun'26 growth curve, recent sales + top procedures populated, no console errors.

- [ ] **Step 5: Commit** `feat: assemble Overview page (live data)`.

---

## Self-Review checklist
- [ ] **Spec coverage:** KPIs (T3/T5), gauges (T3/T5), monthly revenue chart (T1/T6), recent sales (T6), top procedures (T2/T6), Ask-bar stub (T7), gold theme reuse (T5–T7). Origin/professional intentionally dropped.
- [ ] **Placeholder scan:** all logic tasks have full code + tests; UI tasks reference the approved mockup + exact tokens.
- [ ] **Type consistency:** `OverviewData`/`Kpi`/`Gauge`/`MonthPoint`/`RecentSale`/`ProcCount` defined in T3 and consumed unchanged in T4–T7; `computeOverview(vendas, clientes, goals, now)` signature stable; `getOverviewData()` returns `OverviewData`.

## Next: Plan 3 (Patients page) — schema-introspected table + detail drawer with the patient's `gestek_vendas` history.
