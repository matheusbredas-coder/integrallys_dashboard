# Descontos Gauge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Overview "Conversão" gauge with a "Descontos" gauge showing total discounts given (R$) in the selected period, with a ring reading the discount-as-%-of-gross rate.

**Architecture:** The gauge lives in the existing `Gauge[]` array built in two places — `timeframe.ts` (`buildOverviewSlice`, the live render path) and `aggregate.ts` (`computeOverview`, legacy but still tested). The discount amount comes from `valor_desconto` (the canonical BRL discount; `desconto` is unusable because it stores a percentage for `tipo_desconto = 0` sales). A DB migration exposes `valor_desconto` on `vendas_view`; the data layer selects it; both gauge builders sum it.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Supabase/Postgres views.

Spec: `docs/superpowers/specs/2026-06-05-descontos-gauge-design.md`

---

### Task 1: Expose `valor_desconto` on `vendas_view` (DB migration)

**Files:**
- Create: `db/migrations/013_vendas_view_discount.sql`

- [ ] **Step 1: Write the migration**

Create `db/migrations/013_vendas_view_discount.sql` with the full file below. It re-creates `vendas_view` identically to migration 006 plus one new column, `valor_desconto`.

```sql
-- Re-create vendas_view to also expose valor_desconto, the canonical BRL discount.
--
-- Why: gestek_vendas.desconto is a PERCENTAGE for tipo_desconto = 0 sales, so it
-- cannot be summed across sales. valor_desconto is always the resolved discount in
-- reais (it equals subtotal - total), so it is the field the Overview "Descontos"
-- gauge sums. Migration 006 exposed only `desconto`; this adds `valor_desconto`.
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
  coalesce(v.valor_desconto, 0)::numeric                   as valor_desconto,
  v.profissional
from public.gestek_vendas v
where v.status = 1;

grant select on public.vendas_view to anon, authenticated, service_role;
```

- [ ] **Step 2: Apply the migration**

This project applies migrations by hand (see the header comment in `gestek_vendas.sql`). Paste the contents of `db/migrations/013_vendas_view_discount.sql` into the Supabase SQL editor and run it once.

- [ ] **Step 3: Verify the column exists with the right values**

Run (from the repo root; reads creds from `.env`):

```bash
URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' .env | cut -d= -f2- | tr -d '"') \
KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env | cut -d= -f2- | tr -d '"') \
node -e 'const u=process.env.URL,k=process.env.KEY;const H={apikey:k,Authorization:`Bearer ${k}`};fetch(`${u}/rest/v1/vendas_view?valor_desconto=gt.0&select=codigo,total,valor_desconto&limit=3`,{headers:H}).then(r=>r.json()).then(x=>console.log(JSON.stringify(x,null,2)))'
```

Expected: three rows, each with a numeric `valor_desconto > 0` (e.g. `codigo 844 → valor_desconto 360`). If you get `{"code":"42703"}` (column does not exist), the migration was not applied — redo Step 2.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/013_vendas_view_discount.sql
git commit -m "feat(overview): expose valor_desconto on vendas_view"
```

---

### Task 2: Descontos gauge on the live path (`timeframe.ts`) + plumbing

This is the user-visible change: types, data-layer select, the `buildOverviewSlice` gauge, and its test. Do it test-first.

**Files:**
- Modify: `src/features/overview/types.ts`
- Modify: `src/features/overview/data.ts:25-26`
- Modify: `src/features/overview/timeframe.ts`
- Test: `src/features/overview/timeframe.test.ts`

- [ ] **Step 1: Update the test fixtures and replace the conversion test**

In `src/features/overview/timeframe.test.ts`:

(a) Add `valor_desconto` to every `vendas` fixture and remove `numero_vendas` from every `clientes` fixture. Replace the `vendas` and `clientes` arrays (lines 6-17) with:

```ts
  vendas: [
    { sold_at: "2026-06-16T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, valor_desconto: 30, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-15T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 200, valor_pago: 150, valor_desconto: 20, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-02T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, valor_desconto: 50, procedimentos: "MONJAURO 2,5 MG (2)" },
    { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "3", cliente_nome: "CARLA", total: 400, valor_pago: 400, valor_desconto: 100, procedimentos: "PEELING (1)" },
  ],
  clientes: [
    { id: "1", cadastro_at: "2026-06-16T09:00:00Z" },
    { id: "2", cadastro_at: "2026-06-15T09:00:00Z" },
    { id: "3", cadastro_at: "2026-06-02T09:00:00Z" },
    { id: "4", cadastro_at: "2026-05-02T09:00:00Z" },
  ],
```

(b) Replace the entire `it("conversion = ...")` block (lines 61-67) with:

```ts
  it("discounts = sum of valor_desconto over the period, ring = share of gross", () => {
    const disc = (s: ReturnType<typeof buildOverviewSlice>) => s.gauges.find((g) => g.key === "discounts")!;
    // cumulative valor_desconto / (revenueBilled + valor_desconto) per preset
    expect(disc(slice("today")).value).toBe("R$ 30");
    expect(disc(slice("today")).pct).toBeCloseTo(30 / 330);   // 300 billed + 30 disc
    expect(disc(slice("week")).value).toBe("R$ 50");
    expect(disc(slice("week")).pct).toBeCloseTo(50 / 550);    // 500 + 50
    expect(disc(slice("month")).value).toBe("R$ 100");
    expect(disc(slice("month")).pct).toBeCloseTo(100 / 1100); // 1000 + 100
    expect(disc(slice("year")).value).toBe("R$ 200");
    expect(disc(slice("year")).pct).toBeCloseTo(200 / 1600);  // 1400 + 200
    expect(disc(slice("month")).label).toBe("Descontos");
    expect(slice("month").gauges.find((g) => g.key === "conversion")).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/overview/timeframe.test.ts`
Expected: FAIL — the `discounts` test throws because `gauges.find(g => g.key === "discounts")` is `undefined` (so `.value` is read off `undefined`). The other test in the file still passes.

- [ ] **Step 3: Update shared types**

In `src/features/overview/types.ts`:

Replace the `VendaRow` type (lines 1-8) so it includes `valor_desconto`:

```ts
export type VendaRow = {
  sold_at: string;
  cliente_supabase_id: string | null;
  cliente_nome: string | null;
  total: number;
  valor_pago: number;
  valor_desconto: number;
  procedimentos: string | null;
};
```

Replace the `ClienteRow` type (line 9) — drop `numero_vendas`:

```ts
export type ClienteRow = { id: string; cadastro_at: string | null };
```

- [ ] **Step 4: Update the data-layer selects**

In `src/features/overview/data.ts`, change the two `selectAll` column lists (lines 25-26):

```ts
    selectAll<OverviewSource["vendas"][number]>(sb, "vendas_view", "sold_at, cliente_supabase_id, cliente_nome, total, valor_pago, valor_desconto, procedimentos"),
    selectAll<OverviewSource["clientes"][number]>(sb, "clientes_view", "id, cadastro_at"),
```

- [ ] **Step 5: Implement the Descontos gauge in `timeframe.ts`**

In `src/features/overview/timeframe.ts`:

(a) Remove the now-unused `pct` helper (lines 170-172):

```ts
function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "—";
}
```

(b) Remove the `convertedPatients` line (line 202):

```ts
  const convertedPatients = clientes.filter((c) => (c.numero_vendas ?? 0) > 0).length;
```

(c) Add the discount totals next to `revenueBilled` (right after line 197, `const revenueBilled = ...`):

```ts
  const discountsGiven = vendas.reduce((a, v) => a + (Number(v.valor_desconto) || 0), 0);
  const gross = revenueBilled + discountsGiven; // faturamento bruto (subtotal)
```

(d) Replace the `conversion` entry in the `gauges` array (line 211) with:

```ts
    { key: "discounts", label: "Descontos", sub: "% do faturamento bruto", value: brl(discountsGiven), pct: clamp(gross ? discountsGiven / gross : 0) },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/features/overview/timeframe.test.ts`
Expected: PASS (both tests).

- [ ] **Step 7: Commit**

```bash
git add src/features/overview/types.ts src/features/overview/data.ts src/features/overview/timeframe.ts src/features/overview/timeframe.test.ts
git commit -m "feat(overview): replace Conversão gauge with Descontos on live path"
```

---

### Task 3: Descontos gauge parity in the legacy path (`aggregate.ts`)

`computeOverview` is not on the render path but is exported and unit-tested, so keep it in sync. Test-first.

**Files:**
- Modify: `src/features/overview/aggregate.ts`
- Test: `src/features/overview/aggregate.test.ts`

- [ ] **Step 1: Update fixtures and the conversion assertion**

In `src/features/overview/aggregate.test.ts`:

(a) Replace the `vendas` array (lines 6-10) — add `valor_desconto`:

```ts
const vendas: VendaRow[] = [
  { sold_at: "2026-05-02T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, valor_desconto: 100, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 200, valor_pago: 150, valor_desconto: 0, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-06-01T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, valor_desconto: 50, procedimentos: "MONJAURO 2,5 MG (2)" },
];
```

(b) Replace the `clientes` array (lines 11-15) — drop `numero_vendas`:

```ts
const clientes: ClienteRow[] = [
  { id: "1", cadastro_at: "2026-05-01T00:00:00Z" },
  { id: "2", cadastro_at: "2026-06-01T00:00:00Z" },
  { id: "3", cadastro_at: "2026-06-02T00:00:00Z" },
];
```

(c) Replace the gauges test (lines 34-37) with:

```ts
  it("gauges: revenue-this-month vs goal + discounts", () => {
    expect(d.gauges.find((g) => g.key === "revenue")!.pct).toBeCloseTo(0.5);
    const disc = d.gauges.find((g) => g.key === "discounts")!;
    expect(disc.value).toBe("R$ 150");          // 100 + 0 + 50
    expect(disc.pct).toBeCloseTo(150 / 1150);   // 1000 billed + 150 disc
    expect(d.gauges.find((g) => g.key === "conversion")).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/overview/aggregate.test.ts`
Expected: FAIL — `gauges.find(g => g.key === "discounts")` is `undefined`.

- [ ] **Step 3: Implement the gauge in `aggregate.ts`**

In `src/features/overview/aggregate.ts`:

(a) Remove the `convertedPatients` line (line 12):

```ts
  const convertedPatients = clientes.filter((c) => (c.numero_vendas ?? 0) > 0).length;
```

(b) Add the discount totals right after `revenueCollected` (after line 8):

```ts
  const discountsGiven = vendas.reduce((a, v) => a + (Number(v.valor_desconto) || 0), 0);
  const gross = revenueBilled + discountsGiven; // faturamento bruto (subtotal)
```

(c) Replace the `conversion` entry in the `gauges` array (line 29) with:

```ts
    { key: "discounts", label: "Descontos", sub: "% do faturamento bruto", value: brl(discountsGiven), pct: clamp(gross ? discountsGiven / gross : 0) },
```

(d) Remove the now-unused `pct` helper (line 47):

```ts
function pct(a: number, b: number) { return b ? `${Math.round((a / b) * 100)}%` : "—"; }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/overview/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/overview/aggregate.ts src/features/overview/aggregate.test.ts
git commit -m "feat(overview): mirror Descontos gauge in computeOverview"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: all tests pass (no `conversion` references remain).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors. In particular, no "unused variable" for `pct`, `convertedPatients`, or `numero_vendas` (all removed).

- [ ] **Step 3: Type-check via build (catches the removed `numero_vendas` / added `valor_desconto`)**

Run: `npm run build`
Expected: build succeeds. A failure here usually means a fixture or call site still references `numero_vendas`, or a `VendaRow` literal is missing `valor_desconto`.

- [ ] **Step 4: Manual visual check**

Run: `npm run dev`, open the Overview page. Confirm the 3rd gauge now reads **Descontos** with a `R$` value and a percentage ring; confirm **Conversão** is gone. Change the period picker and confirm the value/ring update.

- [ ] **Step 5: Commit any incidental fixes**

If Steps 1-4 required fixes:

```bash
git add -A
git commit -m "chore(overview): finalize Descontos gauge"
```

---

## Notes for the implementer

- `brl(n)` renders `R$ ${Math.round(n).toLocaleString("pt-BR")}` — so `brl(150)` is exactly `"R$ 150"` (no thousands separator at these magnitudes). The test strings rely on this.
- Vitest transpiles TS with esbuild and does **not** type-check, so the red/green steps fail on runtime assertions, not type errors. `npm run build` (Task 4 Step 3) is what enforces the type changes.
- The ring denominator (`gross`) is derived from the already-computed `revenueBilled` plus `discountsGiven` — no extra DB column is needed for it.
- If the migration (Task 1) is not yet applied when the app runs, `valor_desconto` comes back `undefined` and the gauge shows `R$ 0` (graceful), so apply Task 1 first.
