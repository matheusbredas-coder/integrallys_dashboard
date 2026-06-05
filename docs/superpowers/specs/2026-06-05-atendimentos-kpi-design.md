# Atendimentos KPI — Design

**Date:** 2026-06-05
**Branch:** `build/foundation`
**Status:** Approved (design), pending implementation plan

## Goal

Replace the **Pacientes** KPI card on the Overview dashboard with **Atendimentos** —
a count of *realized consultations* sourced from the Gestek `/api/agenda` endpoint.

## Background & data investigation

The dashboard's Overview reads all metrics from Supabase views (`vendas_view`,
`clientes_view`, `app_settings`) loaded once server-side into `OverviewSource`, then
filters in-memory by the selected timeframe (today/week/month/year) in
`buildOverviewSlice`. The current "Pacientes" card counts patients *registered* in the
selected period.

We investigated the Gestek `/api/agenda` endpoint directly (read-only GETs) to decide
between storing the data in Supabase vs. calling the API live, and to confirm accuracy.

### What `/api/agenda` returns

Each item: `id`, `dataAgendamentoInicio`, `pendente` (bool), `clienteNome`,
`clienteTelefone`, `profissional{id,nome,cargo}`, `salaAtendimento{id,nome}`,
`procedimentos[]{id,nome,duracaoMinutos,valor,custo,descricao}`. Response shape:
`{ agendamentos: [...], totais: { totalResultados, pagina, resultadosPorPagina } }`.
Pagination is **0-indexed** (`Page=0` first). Date params are required, format
`yyyy-MM-ddTHH:mm:ssZ`.

### Definition of "realized" (verified)

`pendente` is **not** merely a time flag: a fully-past month (2026-03) had 106 `false`
and **3 `true`** (staff leave unattended slots pending). So:

> **Atendimento realizado = agenda row where `pendente === false`.**

### Accuracy vs. the real Gestek calendar (verified)

Reconciling specific days (Apr 2/14/24 2026) against the clinic's actual calendar:

| Calendar layer | In `/api/agenda`? | Correct? |
|---|---|---|
| 🟢 Green "Receita – Venda de Produto" (sales ledger) | **No** | ✅ That's `gestek_vendas`, not consultations |
| 🟣 Purple "Lembrete" (reminders) | **No** | ✅ Excluded |
| 🔵 Blue timed consultations | **Yes** (`pendente=false`) | ✅ Realized |
| 🔴 Red timed (REVISÃO/BOTOX — color = procedure type) | **Yes** (`pendente=false`) | ✅ Real appts |
| ⚪ Cancelled slot (e.g. Apr 2 06:30) | **No** | ✅ Dropped — good |
| 🟠 Holidays (Paixão de Cristo, Tiradentes) | **No** | ✅ Not appts |

The endpoint is clean: the green sales bars and purple reminders that pollute the calendar
UI **never come through the API**. Per-day API counts matched the calendar's timed events
exactly (after UTC→America/Sao_Paulo conversion).

### Coverage (verified)

Agenda adoption started ~June 2025 and ramps to full use; every 2026 month is well-populated
(monthly totals 61–146). Pre-June-2025 is empty.

## Architecture decision: store in Supabase (not live API)

Chosen **Option A — store in Supabase, sync like vendas.** Rationale:

- The dashboard is built as *load-source-once, filter-in-memory-by-timeframe*. A live API
  call would have to preload the full year on every page load anyway, while adding a
  rate-limited (Gestek 429s) external dependency to the render path.
- Consistency: every other dashboard number comes from a Supabase view.
- Reuses the existing pagination / 429-backoff / monthly-window sync infra.
- Persists history for future agenda charts.
- Freshness = last sync, identical to how Pacientes/Vendas already behave.

## Components

### 1. Migration `db/migrations/011_gestek_agenda.sql`

Raw table (clean snake_case — we own it) + a read view, mirroring `gestek_vendas`/`vendas_view`.

```sql
create table public.gestek_agenda (
  id                text primary key,       -- Gestek agendamento id
  data_inicio       timestamptz not null,   -- dataAgendamentoInicio
  pendente          boolean not null,
  cliente_nome      text,
  cliente_telefone  text,
  profissional_id   text,
  profissional_nome text,
  sala_nome         text,
  procedimentos     jsonb,                  -- [{id,nome,duracaoMinutos,valor}]
  synced_at         timestamptz default now()
);
create index on public.gestek_agenda (data_inicio);
create index on public.gestek_agenda (pendente);

create or replace view public.agenda_view as
select
  a.id,
  a.data_inicio                                  as appointment_at,
  (date_trunc('month', a.data_inicio))::date     as appointment_month,
  a.pendente,
  (not a.pendente)                               as realizada,
  a.cliente_nome,
  a.profissional_nome,
  a.procedimentos
from public.gestek_agenda a;

grant select on public.agenda_view to anon, authenticated, service_role;
grant select on public.agenda_view to crm_readonly;  -- chat/text-to-SQL role (migration 005)
```

### 2. Sync extension

**`src/features/sync/types.ts`** — add Gestek + row shapes:
```ts
export type GestekAgendaProc = { id?: string; nome?: string; duracaoMinutos?: number; valor?: number };
export type GestekAgenda = {
  id: string; dataAgendamentoInicio?: string; pendente?: boolean;
  clienteNome?: string; clienteTelefone?: string;
  profissional?: { id?: string; nome?: string };
  salaAtendimento?: { id?: string; nome?: string };
  procedimentos?: GestekAgendaProc[];
};
export type GestekAgendaRow = {
  id: string; data_inicio: string; pendente: boolean;
  cliente_nome: string | null; cliente_telefone: string | null;
  profissional_id: string | null; profissional_nome: string | null;
  sala_nome: string | null; procedimentos: unknown[];
};
```
Add `agenda_upserted?: number` to `SyncSummary`.

**`src/features/sync/gestek-client.ts`** — `fetchAllAgenda(startISO, fetchImpl)`:
mirrors `fetchAllVendas` — `monthlyWindows(startISO)` (≤31-day-safe), per-window
`fetchPaged<GestekAgenda>("/agenda", "agendamentos", { DataInicio: \`${w.start}T00:00:00Z\`,
DataFim: \`${w.end}T23:59:59Z\`, Tipo: "0" }, fetchImpl)`, 250ms throttle between windows,
dedupe by `id`. (`Tipo=0` so historical `pendente=false` and upcoming `pendente=true` are
both stored.)

**`src/features/sync/agenda.ts`** (new, mirrors `sales.ts`) — `mapAgendaToRow(a): GestekAgendaRow`
mapping Gestek fields → row, coercing `procedimentos` to `[]` when absent.

**`src/features/sync/store.ts`** — add `upsertAgenda(rows)` (batched `upsert onConflict:id`,
same shape as `upsertVendas`).

**`src/features/sync/run-sync.ts`**:
- Extend `GestekApi` with `fetchAllAgenda: (startISO) => Promise<GestekAgenda[]>`.
- Agenda window start = **agenda adoption start**, default `2025-06-01`, overridable via
  `GESTEK_AGENDA_SYNC_FROM`. (User chose full history; upsert-by-id is idempotent/self-healing.)
- After the vendas fetch+upsert: `const agenda = await gestek.fetchAllAgenda(agendaStart);`
  map → `store.upsertAgenda(...)`; on fetch error, `logError` + return `gestek_error` (never
  partial writes — same guard style as vendas).
- Add `agenda_upserted: agendaRows.length` to the summary.

### 3. Aggregate + KPI swap

**`src/features/overview/types.ts`**:
```ts
export type AgendaRow = { appointment_at: string; pendente: boolean };
// OverviewSource: add `agenda: AgendaRow[]`
// Kpi: add `atendimentos: number`   // realized consultations (pendente === false)
```
(Internal field named `atendimentos` to match the UI label and avoid name drift.)

**`src/features/overview/data.ts`** `getOverviewSource`: add
`sb.from("agenda_view").select("appointment_at, pendente")` to the `Promise.all`; include
`agenda` in the returned source.

**`src/features/overview/timeframe.ts`** `buildOverviewSlice`: add
`filteredAgenda(source, timeframe)` (reuse `isWithin` on `appointment_at`), then
`atendimentos = filteredAgenda.filter(a => a.pendente === false).length`; set on the
returned `kpi`.

**`src/features/overview/aggregate.ts`** `computeOverview`: accept agenda (all-time path,
used by `getOverviewData`/tests); set `atendimentos` for parity.

**`src/features/overview/kpi-cards.tsx`**: replace the Pacientes item with
`{ label: "Atendimentos", value: kpi.atendimentos, kind: "int" as const }`.
Order stays: Receita · **Atendimentos** · Vendas · Ticket médio.

## Testing (TDD)

- `gestek-client.test.ts`: `fetchAllAgenda` — `agendamentos` unwrap, 0-indexed pagination,
  cross-window dedupe by id, monthly-window param formatting.
- `agenda.test.ts`: `mapAgendaToRow` — field mapping, missing `procedimentos` → `[]`,
  missing `pendente` handling.
- `timeframe.test.ts`: `atendimentos` counts only `pendente=false` and respects
  today/week/month/year boundaries.
- `aggregate.test.ts`: all-time `atendimentos` parity.

## Out of scope (YAGNI)

- Agenda charts/trends (table persists history; can add later).
- Backfilling pre-June-2025 (no data exists).
- No-show analytics (no explicit no-show status in the API).

## Non-obvious gotchas (carry into the plan)

- Agenda times are **UTC**; the dashboard's timeframe logic already zones to
  America/Sao_Paulo via `localDateKey` — agenda rows flow through the same path, so no extra
  conversion needed in aggregation.
- `/api/agenda` pagination is **0-indexed** (already true for `/clientes`,`/vendas`).
- Gestek **rate-limits** (~30 rapid reqs → 429); reuse `fetchWithRetry` backoff + 250ms
  inter-window throttle. Full-history (~Jun 2025→today ≈ 13 windows) stays within limits.
- `procedimentos[].valor` is `0.0` in agenda — it's a scheduling record, **not billing**.
  Atendimentos ≠ Vendas by design; do not reconcile the two.
