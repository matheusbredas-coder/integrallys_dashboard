# Replace the "Conversão" gauge with a "Descontos" gauge

**Date:** 2026-06-05
**Status:** Approved (design), pending implementation plan

## Goal

On the Overview dashboard, remove the **Conversão** gauge and put a **Descontos**
gauge in its slot, showing the total amount of discounts given in the selected
period (a money total) with a ring that reads the discount rate.

## Saved snapshot — the Conversão gauge (for restore)

Captured verbatim so it can be put back if ever wanted. It is defined identically
in two places:

- `src/features/overview/aggregate.ts` (`computeOverview`, all-time)
- `src/features/overview/timeframe.ts` (`buildOverviewSlice`, period-filtered)

```ts
{ key: "conversion", label: "Conversão", sub: "Novos pacientes que compraram",
  value: pct(convertedPatients, patients),
  pct: clamp(patients ? convertedPatients / patients : 0) }
```

Inputs:

```ts
const patients = clientes.length;
const convertedPatients = clientes.filter((c) => (c.numero_vendas ?? 0) > 0).length;
```

- Ring fill = `convertedPatients / patients`; the ring center shows the same %.
- `value` = `pct(convertedPatients, patients)` → e.g. `"43%"` (`"—"` when no patients).
- `sub` is carried in the data but **not rendered** by `gauges.tsx` (the component
  shows only `label` + `value` + ring).
- Depends on `ClienteRow.numero_vendas`, selected from `clientes_view` in
  `data.ts` and typed in `types.ts`.

## The new Descontos gauge

Drop-in replacement in the same slot, same `Gauge` shape:

```ts
{ key: "discounts", label: "Descontos", sub: "% do faturamento bruto",
  value: brl(discountsGiven),
  pct: clamp(gross ? discountsGiven / gross : 0) }
```

Where:

```ts
const discountsGiven = vendas.reduce((a, v) => a + (Number(v.valor_desconto) || 0), 0);
const gross = revenueBilled + discountsGiven; // faturamento bruto (subtotal)
```

- **value** (big number) = `brl(discountsGiven)`, e.g. `R$ 50.363`.
- **ring** = discount rate as a fraction of **gross**: `discountsGiven / (revenueBilled + discountsGiven)`.
  The ring center shows that % (e.g. `12%`). `revenueBilled` is the existing
  `sum(total)` already computed in both files, so no extra column is needed for the
  denominator.
- Bucketed by **sale date** (`sold_at`), consistent with `revenueBilled`. In
  `timeframe.ts` it is summed over the period-filtered `vendas`; in `aggregate.ts`
  it is summed over all `vendas` (mirroring how the old Conversão gauge was all-time
  there).
- No configurable goal. The Configuração/settings page is **not** touched.

### Accepted trade-off

The gauge ring fills gold and shows a "meta atingida" checkmark at 100%, which reads
as "more is better." For discounts that is inverted, but the rate is effectively
never near 100%, and keeping the gauge shape preserves the 4-gauge row. Accepted.

## Data correctness — use `valor_desconto`, not `desconto`

Verified against live data (838 completed sales, 160 with a discount):

| field | sum | note |
|---|---|---|
| `desconto` | R$ 44.087 | **wrong** — see below |
| `valor_desconto` | R$ 50.363,35 | correct BRL discount |
| `subtotal − total` | R$ 50.363,35 | equals `valor_desconto` exactly |

`tipo_desconto` is `0` for 48 sales and `1` for 790. For the 48 `tipo_desconto = 0`
rows, `desconto` stores a **percentage**, not reais — so summing `desconto` mixes
percentages with reais and is meaningless. `valor_desconto` always equals
`subtotal − total`, so it is the canonical BRL discount amount and the field we use.

The current `vendas_view` (migration 006) exposes only `desconto`, so the view needs
to expose `valor_desconto`.

## Changes

### 1. DB — `db/migrations/013_vendas_view_discount.sql`

Re-create `vendas_view` keeping every existing column and adding:

```sql
coalesce(v.valor_desconto, 0)::numeric as valor_desconto,
```

(Re-issue the existing `grant select ... to anon, authenticated, service_role;`.)

### 2. Types — `src/features/overview/types.ts`

- `VendaRow`: add `valor_desconto: number`.
- `ClienteRow`: remove `numero_vendas` (becomes dead once Conversão is gone).
- `Gauge`: unchanged.

### 3. Data layer — `src/features/overview/data.ts`

- `vendas_view` select: add `valor_desconto`.
- `clientes_view` select: drop `numero_vendas` (now `id, cadastro_at`).

### 4. Gauge builders — `aggregate.ts` and `timeframe.ts`

- Replace the `conversion` gauge entry with the `discounts` entry above.
- Add `discountsGiven` / `gross` computations.
- Remove the now-dead `convertedPatients` (and `patients` if it becomes unused —
  note `patients` is also used by the `newPatients` gauge in `timeframe.ts`, so keep
  it there; in `aggregate.ts` it likewise feeds `newPatients`, keep as needed).

### 5. Tests — `aggregate.test.ts`, `timeframe.test.ts`

Update the conversion-gauge assertions to the `discounts` gauge: given sample
`vendas` with known `valor_desconto`, assert `value === brl(sum)` and
`pct === sum / (sumTotal + sum)`. Update fixtures to include `valor_desconto`
and drop `numero_vendas` from client fixtures. Drive this test-first.

## Out of scope

- Settings/Configuração page (no goal).
- `kpi-cards.tsx`, `revenue-chart.tsx`, `top-procedures.tsx`, `recent-sales.tsx`.
- Removing the legacy `computeOverview`/`getOverviewData` path (kept in sync, not
  deleted).
