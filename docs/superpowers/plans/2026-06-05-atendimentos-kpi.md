# Atendimentos KPI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Pacientes" KPI card on the Overview dashboard with "Atendimentos" — a count of realized consultations (`pendente === false`) sourced from the Gestek `/api/agenda` endpoint and stored in Supabase.

**Architecture:** New `gestek_agenda` table + `agenda_view` in Supabase, populated by extending the existing native in-app sync (fetch `/api/agenda` like `/vendas`, upsert by `id`). The Overview loads agenda rows once into `OverviewSource` and counts `pendente === false` per selected timeframe in `buildOverviewSlice`, exactly mirroring how vendas/clientes already flow.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Supabase (supabase-js service client) + Vitest. Reuses `src/features/sync/*` (pagination, 429-backoff, monthly windows) and `src/features/overview/*` (timeframe slicing).

**Spec:** `docs/superpowers/specs/2026-06-05-atendimentos-kpi-design.md`

**Conventions (from the codebase):**
- Run a single test file: `npx vitest run src/features/sync/agenda.test.ts`
- Run all tests: `npx vitest run`
- Typecheck: `npx tsc --noEmit`
- Gestek pagination is **0-indexed**; date params formatted `yyyy-MM-ddTHH:mm:ssZ`.
- Sync data must be fetched before any write; a fetch error must never leave partial writes.

---

### Task 1: Database migration (`gestek_agenda` table + `agenda_view`)

**Files:**
- Create: `db/migrations/011_gestek_agenda.sql`

- [ ] **Step 1: Write the migration file**

Create `db/migrations/011_gestek_agenda.sql`:

```sql
-- Realized/scheduled consultations pulled from Gestek /api/agenda.
-- "Atendimento realizado" = pendente = false (verified against the live calendar).
create table if not exists public.gestek_agenda (
  id                text primary key,       -- Gestek agendamento id (ObjectId string)
  data_inicio       timestamptz not null,   -- dataAgendamentoInicio (UTC)
  pendente          boolean not null,
  cliente_nome      text,
  cliente_telefone  text,
  profissional_id   text,
  profissional_nome text,
  sala_nome         text,
  procedimentos     jsonb,                  -- [{id,nome,duracaoMinutos,valor}]
  synced_at         timestamptz default now()
);
create index if not exists gestek_agenda_data_inicio_idx on public.gestek_agenda (data_inicio);
create index if not exists gestek_agenda_pendente_idx on public.gestek_agenda (pendente);

create or replace view public.agenda_view as
select
  a.id,
  a.data_inicio                              as appointment_at,
  (date_trunc('month', a.data_inicio))::date as appointment_month,
  a.pendente,
  (not a.pendente)                           as realizada,
  a.cliente_nome,
  a.profissional_nome,
  a.procedimentos
from public.gestek_agenda a;

grant select on public.agenda_view to anon, authenticated, service_role;
grant select on public.agenda_view to crm_readonly;  -- AI chat read-only role (migration 005)
```

- [ ] **Step 2: Apply the migration**

Apply `db/migrations/011_gestek_agenda.sql` in the Supabase SQL editor (Dashboard → SQL Editor), or via psql against the project's direct connection string. (Same process as migrations 001–010 per `db/migrations/README.md`.)

- [ ] **Step 3: Verify the table and view exist**

In the Supabase SQL editor run:

```sql
select count(*) from public.gestek_agenda;          -- expect 0
select count(*) from public.agenda_view;             -- expect 0, no error
```

Expected: both return `0` with no error (table empty, view resolves).

- [ ] **Step 4: Commit**

```bash
git add db/migrations/011_gestek_agenda.sql
git commit -m "feat(db): gestek_agenda table + agenda_view"
```

---

### Task 2: Sync type definitions

**Files:**
- Modify: `src/features/sync/types.ts`

- [ ] **Step 1: Add the Gestek agenda payload + row + summary types**

In `src/features/sync/types.ts`, add after the `GestekVenda` type (around line 10):

```ts
export type GestekAgendaProc = { id?: string; nome?: string; duracaoMinutos?: number; valor?: number };
export type GestekAgenda = {
  id: string;
  dataAgendamentoInicio?: string;
  pendente?: boolean;
  clienteNome?: string;
  clienteTelefone?: string;
  profissional?: { id?: string; nome?: string; cargo?: string | null };
  salaAtendimento?: { id?: string; nome?: string };
  procedimentos?: GestekAgendaProc[];
};
export type GestekAgendaRow = {
  id: string;
  data_inicio: string;
  pendente: boolean;
  cliente_nome: string | null;
  cliente_telefone: string | null;
  profissional_id: string | null;
  profissional_nome: string | null;
  sala_nome: string | null;
  procedimentos: unknown[];
};
```

Then add `agenda_upserted?: number;` to the `SyncSummary` type (alongside `vendas_upserted?: number;`).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (types are unused so far; no errors).

- [ ] **Step 3: Commit**

```bash
git add src/features/sync/types.ts
git commit -m "feat(sync): agenda payload/row types"
```

---

### Task 3: Map a Gestek agenda item to a DB row (`mapAgendaToRow`)

**Files:**
- Create: `src/features/sync/agenda.ts`
- Test: `src/features/sync/agenda.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/sync/agenda.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapAgendaToRow } from "./agenda";
import type { GestekAgenda } from "./types";

describe("mapAgendaToRow", () => {
  it("maps Gestek fields to a gestek_agenda row", () => {
    const a: GestekAgenda = {
      id: "abc123",
      dataAgendamentoInicio: "2026-04-02T15:00:00Z",
      pendente: false,
      clienteNome: "SANDRA REGINA",
      clienteTelefone: "27999999999",
      profissional: { id: "p1", nome: "DR PEDRO" },
      salaAtendimento: { id: "s1", nome: "Sala Principal" },
      procedimentos: [{ id: "x", nome: "MONJAURO 2,5 MG", duracaoMinutos: 10, valor: 0 }],
    };
    const row = mapAgendaToRow(a);
    expect(row).toEqual({
      id: "abc123",
      data_inicio: "2026-04-02T15:00:00Z",
      pendente: false,
      cliente_nome: "SANDRA REGINA",
      cliente_telefone: "27999999999",
      profissional_id: "p1",
      profissional_nome: "DR PEDRO",
      sala_nome: "Sala Principal",
      procedimentos: [{ id: "x", nome: "MONJAURO 2,5 MG", duracaoMinutos: 10, valor: 0 }],
    });
  });

  it("defaults pendente to true and procedimentos to [] when absent", () => {
    const row = mapAgendaToRow({ id: "x", dataAgendamentoInicio: "2026-01-01T00:00:00Z" });
    expect(row.pendente).toBe(true);
    expect(row.procedimentos).toEqual([]);
    expect(row.cliente_nome).toBeNull();
    expect(row.profissional_id).toBeNull();
    expect(row.sala_nome).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sync/agenda.test.ts`
Expected: FAIL — cannot find module `./agenda` / `mapAgendaToRow is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/sync/agenda.ts`:

```ts
import type { GestekAgenda, GestekAgendaRow } from "./types";

// Treat a missing `pendente` as pending (true) — safest default; only pendente === false counts as realized.
export function mapAgendaToRow(a: GestekAgenda): GestekAgendaRow {
  return {
    id: a.id,
    data_inicio: a.dataAgendamentoInicio ?? "",
    pendente: a.pendente ?? true,
    cliente_nome: a.clienteNome ?? null,
    cliente_telefone: a.clienteTelefone ?? null,
    profissional_id: a.profissional?.id ?? null,
    profissional_nome: a.profissional?.nome ?? null,
    sala_nome: a.salaAtendimento?.nome ?? null,
    procedimentos: a.procedimentos ?? [],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sync/agenda.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/agenda.ts src/features/sync/agenda.test.ts
git commit -m "feat(sync): mapAgendaToRow"
```

---

### Task 4: Fetch all agenda items from Gestek (`fetchAllAgenda`)

**Files:**
- Modify: `src/features/sync/gestek-client.ts`
- Test: `src/features/sync/gestek-client.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/features/sync/gestek-client.test.ts` (and add `fetchAllAgenda` to the import on line 2 so it reads `import { fetchAllAgenda, fetchAllClientes, fetchAllVendas, monthlyWindows } from "./gestek-client";`):

```ts
describe("fetchAllAgenda", () => {
  it("windows by month, sends Tipo=0 with datetime bounds, dedupes by id", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-15T00:00:00Z"));
    // every window returns the same agendamento -> deduped to 1 (fresh Response each call)
    const fetchMock = vi.fn().mockImplementation(async () =>
      page("agendamentos", [{ id: "a1", pendente: false }]),
    );
    const promise = fetchAllAgenda("2025-01-01", fetchMock as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    const out = await promise;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(3); // Jan, Feb, Mar
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/agenda");
    expect(String(url)).toContain("Tipo=0");
    expect(String(url)).toContain("Page=0"); // 0-indexed
    expect(String(url)).toContain("DataInicio=2025-01-01T00%3A00%3A00Z");
    expect(String(url)).toContain("DataFim=2025-01-31T23%3A59%3A59Z");
  });
});
```

> Note: `page()` (defined at the top of this test file) wraps items as `[{ [key]: items }]`; the client's `unwrap()` handles both array-wrapped and bare `{ agendamentos: [...] }` shapes, so this fixture is valid.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sync/gestek-client.test.ts`
Expected: FAIL — `fetchAllAgenda` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/features/sync/gestek-client.ts`, add the import of the type at the top (extend the existing import on line 2):

```ts
import type { GestekCliente, GestekVenda, GestekAgenda } from "./types";
```

Then append after `fetchAllVendas` (end of file):

```ts
// Agenda mirrors vendas: the date filter is capped per request, so page month-by-month
// (each calendar month is <= 31 days). Tipo=0 returns both realized (pendente=false) and
// upcoming (pendente=true) appointments; we store both.
export async function fetchAllAgenda(startISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekAgenda[]> {
  const byId = new Map<string, GestekAgenda>();
  const windows = monthlyWindows(startISO);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (i > 0) await sleep(250); // throttle to stay under the rate limit
    const items = await fetchPaged<GestekAgenda>(
      "/agenda",
      "agendamentos",
      { DataInicio: `${w.start}T00:00:00Z`, DataFim: `${w.end}T23:59:59Z`, Tipo: "0" },
      fetchImpl,
    );
    for (const a of items) if (a.id) byId.set(a.id, a);
  }
  return [...byId.values()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sync/gestek-client.test.ts`
Expected: PASS (all describe blocks, including the new `fetchAllAgenda`).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/gestek-client.ts src/features/sync/gestek-client.test.ts
git commit -m "feat(sync): fetchAllAgenda (paged, deduped)"
```

---

### Task 5: Store — `upsertAgenda`

**Files:**
- Modify: `src/features/sync/store.ts`
- Modify: `src/features/sync/run-sync.test.ts` (extend the in-memory store mock so the suite still compiles)

- [ ] **Step 1: Add `upsertAgenda` to the `SyncStore` type and implementation**

In `src/features/sync/store.ts`:

Extend the import on line 3:
```ts
import type { SupabasePatient, NewPatientRow, GestekVendaRow, GestekAgendaRow, SyncSummary, SyncWarning } from "./types";
```

Add to the `SyncStore` type (after `upsertVendas`):
```ts
  upsertAgenda(rows: GestekAgendaRow[]): Promise<void>;
```

Add to the returned object (after the `upsertVendas` method):
```ts
    async upsertAgenda(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const r = await sb.from("gestek_agenda").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (r.error) throw r.error;
      }
    },
```

- [ ] **Step 2: Update the run-sync test's in-memory store mock**

In `src/features/sync/run-sync.test.ts`, update `makeStore` so the mock satisfies the `SyncStore` type. Change the `upserted` capture to track agenda too:

Replace the `makeStore` function (lines 6–16) with:
```ts
function makeStore(patients: SupabasePatient[]) {
  const inserted: unknown[] = [];
  const upserted: unknown[] = [];
  const agenda: unknown[] = [];
  const store: SyncStore = {
    readPatients: async () => patients,
    insertPatients: async (rows) => { inserted.push(...rows); },
    upsertVendas: async (rows) => { upserted.push(...rows); },
    upsertAgenda: async (rows) => { agenda.push(...rows); },
    logStart: async () => {}, logComplete: async () => {}, logError: async () => {},
  };
  return { store, inserted, upserted, agenda };
}
```

- [ ] **Step 3: Run the sync test suite to verify it still passes**

Run: `npx vitest run src/features/sync/run-sync.test.ts`
Expected: PASS — the existing tests still pass (note: `runGestekSync` does not call `upsertAgenda` yet, so `agenda` stays empty; that's wired in Task 6).

> If this fails because the default `gestek` deps in `run-sync.ts` now reference an unset `fetchAllAgenda`, that is wired in Task 6 — but the default-deps change is only made in Task 6, so this step should pass as-is.

- [ ] **Step 4: Commit**

```bash
git add src/features/sync/store.ts src/features/sync/run-sync.test.ts
git commit -m "feat(sync): store.upsertAgenda"
```

---

### Task 6: Wire agenda into `runGestekSync`

**Files:**
- Modify: `src/features/sync/run-sync.ts`
- Test: `src/features/sync/run-sync.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/features/sync/run-sync.test.ts`:

Extend the `gestek` helper (lines 17–20) to provide agenda, and add a `GestekAgenda` import:

Update the type import (line 4):
```ts
import type { GestekAgenda, GestekCliente, GestekVenda, SupabasePatient } from "./types";
```

Replace the `gestek` helper:
```ts
const gestek = (clientes: GestekCliente[], vendas: GestekVenda[], agenda: GestekAgenda[] = []) => ({
  fetchAllClientes: async () => clientes,
  fetchAllVendas: async () => vendas,
  fetchAllAgenda: async () => agenda,
});
```

Add a new test inside the `describe("runGestekSync", ...)` block:
```ts
  it("upserts agenda rows and reports agenda_upserted", async () => {
    const { store, agenda } = makeStore(existing);
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    const agendaItems: GestekAgenda[] = [
      { id: "a1", dataAgendamentoInicio: "2026-06-01T12:00:00Z", pendente: false, clienteNome: "ANA" },
      { id: "a2", dataAgendamentoInicio: "2026-06-02T12:00:00Z", pendente: true, clienteNome: "BIA" },
    ];
    const r = await runGestekSync(
      { dryRun: false },
      { store, gestek: gestek(clientes, [], agendaItems), now: () => new Date("2026-06-04T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.summary?.agenda_upserted).toBe(2);
    expect(agenda).toHaveLength(2);
  });

  it("dry-run does not upsert agenda", async () => {
    const { store, agenda } = makeStore(existing);
    const clientes = existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome }));
    const agendaItems: GestekAgenda[] = [{ id: "a1", dataAgendamentoInicio: "2026-06-01T12:00:00Z", pendente: false }];
    const r = await runGestekSync(
      { dryRun: true },
      { store, gestek: gestek(clientes, [], agendaItems), now: () => new Date("2026-06-04T00:00:00Z") },
    );
    expect(r.ok).toBe(true);
    expect(agenda).toHaveLength(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/sync/run-sync.test.ts`
Expected: FAIL — `agenda_upserted` is undefined and `agenda` has length 0 (agenda not wired yet).

- [ ] **Step 3: Implement the wiring**

In `src/features/sync/run-sync.ts`:

Extend the type import (line 3) to include `GestekAgenda` and `GestekAgendaRow`:
```ts
import type { GestekAgenda, GestekAgendaRow, GestekCliente, GestekVenda, NewPatientRow, SyncResult, SyncSummary, SyncWarning } from "./types";
```

Add the import of the mapper and fetcher (extend line 5 and line 8):
```ts
import { splitPatients, normalizeName } from "./match";
import { mapVendaToRow } from "./sales";
import { mapAgendaToRow } from "./agenda";
import { createSyncStore } from "./store";
import { fetchAllClientes, fetchAllVendas, fetchAllAgenda } from "./gestek-client";
```

Extend the `GestekApi` type (after `fetchAllVendas`):
```ts
export type GestekApi = {
  fetchAllClientes: () => Promise<GestekCliente[]>;
  fetchAllVendas: (startISO: string) => Promise<GestekVenda[]>;
  fetchAllAgenda: (startISO: string) => Promise<GestekAgenda[]>;
};
```

Update the default deps (line 26):
```ts
  const gestek = deps?.gestek ?? {
    fetchAllClientes,
    fetchAllVendas: (s: string) => fetchAllVendas(s),
    fetchAllAgenda: (s: string) => fetchAllAgenda(s),
  };
```

After the vendas block (after `const vendaRows = ...`, around line 90), add the agenda fetch + map:
```ts
  // Agenda (Atendimentos). Full history is cheap to keep idempotent via upsert-by-id.
  // Default start = agenda adoption (~2025-06); override with GESTEK_AGENDA_SYNC_FROM.
  const agendaStart = process.env.GESTEK_AGENDA_SYNC_FROM || "2025-06-01";
  let agenda: GestekAgenda[];
  try {
    agenda = await gestek.fetchAllAgenda(agendaStart);
  } catch (e) {
    if (!dryRun) await store.logError(run_id, now().toISOString(), e instanceof Error ? e.message : "falha ao buscar agenda");
    return { ok: false, code: "gestek_error", message: e instanceof Error ? e.message : "Falha ao buscar agenda do Gestek." };
  }
  const agendaRows: GestekAgendaRow[] = agenda.filter((a) => a.id).map(mapAgendaToRow);
```

Update the write block (the `if (!dryRun) { ... }` around line 92) to also upsert agenda:
```ts
  if (!dryRun) {
    await store.insertPatients(newRows);
    await store.upsertVendas(vendaRows);
    await store.upsertAgenda(agendaRows);
  }
```

Add `agenda_upserted` to the summary object (in the `const summary: SyncSummary = { ... }`):
```ts
    total_clientes: clientes.length, patients_inserted: newRows.length, vendas_upserted: vendaRows.length,
    agenda_upserted: agendaRows.length,
    orphan_supabase_patients: split.orphans.length, duplicate_name_warnings: warnings.length,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/sync/run-sync.test.ts`
Expected: PASS (all existing tests + the 2 new agenda tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/run-sync.ts src/features/sync/run-sync.test.ts
git commit -m "feat(sync): fetch+upsert agenda in runGestekSync"
```

---

### Task 7: Overview plumbing — types, source query, zeroed KPI

**Files:**
- Modify: `src/features/overview/types.ts`
- Modify: `src/features/overview/data.ts`
- Modify: `src/features/overview/aggregate.ts`
- Modify: `src/features/overview/timeframe.ts`
- Modify: `src/features/overview/timeframe.test.ts` (add `agenda: []` to the fixture so it compiles)

This task adds the `atendimentos` field end-to-end but leaves it at `0` (behavior lands in Tasks 8–9). It keeps the whole app compiling and all tests green.

- [ ] **Step 1: Add types**

In `src/features/overview/types.ts`:

Add the row type (after `ClienteRow`, line 9):
```ts
export type AgendaRow = { appointment_at: string; pendente: boolean };
```

Add `atendimentos` to `Kpi`:
```ts
export type Kpi = {
  revenueBilled: number; revenueCollected: number; outstanding: number;
  patients: number; buyers: number; sales: number; avgTicket: number; atendimentos: number;
};
```

Add `agenda` to `OverviewSource`:
```ts
export type OverviewSource = { vendas: VendaRow[]; clientes: ClienteRow[]; agenda: AgendaRow[]; goals: Goals; recent: RecentSale[]; nowIso: string };
```

- [ ] **Step 2: Load agenda in the source**

In `src/features/overview/data.ts` `getOverviewSource`:

Add `agenda_view` to the `Promise.all` (extend the array and destructuring):
```ts
  const [vendasRes, clientesRes, agendaRes, settingsRes] = await Promise.all([
    sb.from("vendas_view").select("sold_at, cliente_supabase_id, cliente_nome, total, valor_pago, procedimentos"),
    sb.from("clientes_view").select("id, cadastro_at"),
    sb.from("agenda_view").select("appointment_at, pendente"),
    sb.from("app_settings").select("key, value"),
  ]);
  if (vendasRes.error) throw vendasRes.error;
  if (clientesRes.error) throw clientesRes.error;
  if (agendaRes.error) throw agendaRes.error;
```

Add `agenda` to the returned object:
```ts
  return {
    vendas: vendasRes.data ?? [],
    clientes: clientesRes.data ?? [],
    agenda: agendaRes.data ?? [],
    goals,
    recent,
    nowIso: now.toISOString(),
  };
```

- [ ] **Step 3: Thread `atendimentos` through both compute paths (value 0 for now)**

In `src/features/overview/aggregate.ts`:

Add the type import (extend line 2):
```ts
import type { VendaRow, ClienteRow, AgendaRow, Goals, OverviewData, MonthPoint, Gauge } from "./types";
```

Change the `computeOverview` signature to accept agenda (default empty keeps existing call sites valid):
```ts
export function computeOverview(vendas: VendaRow[], clientes: ClienteRow[], goals: Goals, now: Date, agenda: AgendaRow[] = []): OverviewData {
```

Add the count near the other totals (after `const patients = clientes.length;`):
```ts
  const atendimentos = agenda.filter((a) => a.pendente === false).length;
```

Add `atendimentos` to the returned `kpi`:
```ts
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket, atendimentos },
```

In `src/features/overview/data.ts` `getOverviewData`, pass agenda through:
```ts
  return computeOverview(source.vendas, source.clientes, source.goals, now, source.agenda);
```

In `src/features/overview/timeframe.ts` `buildOverviewSlice`, add `atendimentos: 0` to the returned `kpi` (real logic in Task 8):
```ts
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket, atendimentos: 0 },
```

- [ ] **Step 4: Keep existing test fixtures compiling**

In `src/features/overview/timeframe.test.ts`, add `agenda: []` to the `source` object (after the `clientes: [...]` array, before `goals`):
```ts
  agenda: [],
```

- [ ] **Step 5: Typecheck and run the overview tests**

Run: `npx tsc --noEmit && npx vitest run src/features/overview`
Expected: PASS — everything compiles; existing overview tests still pass (atendimentos present but 0).

- [ ] **Step 6: Commit**

```bash
git add src/features/overview/types.ts src/features/overview/data.ts src/features/overview/aggregate.ts src/features/overview/timeframe.ts src/features/overview/timeframe.test.ts
git commit -m "feat(overview): plumb agenda source + atendimentos field"
```

---

### Task 8: Count `atendimentos` per timeframe (`buildOverviewSlice`)

**Files:**
- Modify: `src/features/overview/timeframe.ts`
- Test: `src/features/overview/timeframe.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/features/overview/timeframe.test.ts`, replace the `agenda: []` line in the fixture with realized + pending appointments spanning timeframes (now = 2026-06-16):
```ts
  agenda: [
    { appointment_at: "2026-06-16T14:00:00Z", pendente: false }, // today, realized
    { appointment_at: "2026-06-16T15:00:00Z", pendente: true },  // today, pending (not counted)
    { appointment_at: "2026-06-15T14:00:00Z", pendente: false }, // this week, realized
    { appointment_at: "2026-06-02T14:00:00Z", pendente: false }, // this month, realized
    { appointment_at: "2026-05-20T14:00:00Z", pendente: false }, // this year, realized
  ],
```

Add assertions inside the existing `it("changes KPI and chart data by timeframe", ...)` test (after the `sales` assertions):
```ts
    expect(today.kpi.atendimentos).toBe(1);  // 1 realized today (the pending one excluded)
    expect(week.kpi.atendimentos).toBe(2);   // today + 06-15
    expect(month.kpi.atendimentos).toBe(3);  // + 06-02
    expect(year.kpi.atendimentos).toBe(4);   // + 05-20
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/overview/timeframe.test.ts`
Expected: FAIL — `atendimentos` is `0` for every timeframe.

- [ ] **Step 3: Implement the filter + count**

In `src/features/overview/timeframe.ts`:

Add the type import (extend line 2 to include `AgendaRow`):
```ts
import type { AgendaRow, ClienteRow, Gauge, OverviewSource, ProcCount, RevenuePoint, Timeframe, VendaRow } from "./types";
```

Add a `filteredAgenda` helper next to `filteredClients` (after line 135):
```ts
function filteredAgenda(source: OverviewSource, timeframe: Timeframe): AgendaRow[] {
  const now = new Date(source.nowIso);
  const start = startOfTimeframe(now, timeframe);
  const end = localDateKey(now);
  return source.agenda.filter((a) => isWithin(localDateKey(new Date(a.appointment_at)), start, end));
}
```

In `buildOverviewSlice`, compute the count (after `const clientes = filteredClients(source, timeframe);`, line 157):
```ts
  const atendimentos = filteredAgenda(source, timeframe).filter((a) => a.pendente === false).length;
```

Update the returned `kpi` to use it (replace `atendimentos: 0`):
```ts
    kpi: { revenueBilled, revenueCollected, outstanding: revenueBilled - revenueCollected, patients, buyers, sales, avgTicket, atendimentos },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/overview/timeframe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/overview/timeframe.ts src/features/overview/timeframe.test.ts
git commit -m "feat(overview): count atendimentos per timeframe"
```

---

### Task 9: All-time `atendimentos` parity (`computeOverview`)

**Files:**
- Test: `src/features/overview/aggregate.test.ts`

`computeOverview` already counts `atendimentos` (Task 7, Step 3). This task locks that behavior with a test.

- [ ] **Step 1: Write the failing test**

`aggregate.test.ts` already imports `describe/it/expect`, `computeOverview`, and `VendaRow, ClienteRow, Goals` from `./types`. Make two edits:

(a) Add `AgendaRow` to the existing types import on line 3:
```ts
import type { VendaRow, ClienteRow, Goals, AgendaRow } from "./types";
```

(b) Append the new `describe` block at the end of the file (no new `import` lines — reuse the ones at the top):
```ts
describe("computeOverview atendimentos", () => {
  it("counts only pendente === false across all agenda rows", () => {
    const agenda: AgendaRow[] = [
      { appointment_at: "2026-06-01T12:00:00Z", pendente: false },
      { appointment_at: "2026-06-02T12:00:00Z", pendente: false },
      { appointment_at: "2026-06-03T12:00:00Z", pendente: true },
    ];
    const out = computeOverview([], [], goals, NOW, agenda);
    expect(out.kpi.atendimentos).toBe(2);
  });

  it("defaults atendimentos to 0 when agenda is omitted", () => {
    const out = computeOverview([], [], goals, NOW);
    expect(out.kpi.atendimentos).toBe(0);
  });
});
```
(`goals` and `NOW` are the module-level constants already defined at the top of the file.)

- [ ] **Step 2: Run test to verify it passes (behavior already implemented in Task 7)**

Run: `npx vitest run src/features/overview/aggregate.test.ts`
Expected: PASS. (If it fails, the Task 7 Step 3 change to `computeOverview` was not applied — fix there.)

- [ ] **Step 3: Commit**

```bash
git add src/features/overview/aggregate.test.ts
git commit -m "test(overview): lock all-time atendimentos count"
```

---

### Task 10: Swap the KPI card (Pacientes → Atendimentos)

**Files:**
- Modify: `src/features/overview/kpi-cards.tsx:30-33`

- [ ] **Step 1: Replace the Pacientes item**

In `src/features/overview/kpi-cards.tsx`, replace the Pacientes line in the `items` array:

Change:
```tsx
    { label: "Pacientes", value: kpi.patients, kind: "int" as const },
```
to:
```tsx
    { label: "Atendimentos", value: kpi.atendimentos, kind: "int" as const },
```

(Order stays: Receita (faturada) · **Atendimentos** · Vendas · Ticket médio.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/overview/kpi-cards.tsx
git commit -m "feat(overview): swap Pacientes KPI for Atendimentos"
```

---

### Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green.

- [ ] **Step 2: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Populate agenda data via a real sync**

With migration 011 applied (Task 1) and `SYNC_ENABLED` on, trigger a sync (Settings page Sync button, or `POST /api/sync`). Then in the Supabase SQL editor confirm rows landed:
```sql
select count(*) total, count(*) filter (where not pendente) realizadas from public.gestek_agenda;
```
Expected: `total` > 0 and `realizadas` > 0 (e.g., hundreds across 2025-06 → today).

- [ ] **Step 4: Verify the dashboard live**

Run the app (`npm run dev`, port 3000), open the Overview, and confirm:
- The second KPI card reads **"Atendimentos"** (not "Pacientes") with an integer value.
- Switching the timeframe (Hoje / Semana / Mês / Ano) changes the Atendimentos value, and **Ano** ≥ **Mês** ≥ **Semana** ≥ **Hoje**.
- No console errors.

Cross-check the **Ano** value against the live count:
```sql
select count(*) from public.gestek_agenda
where not pendente and data_inicio >= date_trunc('year', now());
```
The dashboard's **Ano** Atendimentos should match this count (allowing for timezone bucketing at year boundaries).

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: atendimentos KPI verification fixups"
```
(Skip if nothing changed.)

---

## Notes for the implementer

- **Do not reconcile Atendimentos with Vendas** — agenda is a scheduling record (`procedimentos[].valor` is `0.0`), not billing. They are different metrics by design.
- **Rate limits:** Gestek 429s on ~30 rapid requests. `fetchAllAgenda` reuses the existing `fetchWithRetry` backoff and throttles 250ms between monthly windows; full history (~Jun 2025 → today ≈ 13 windows) stays within limits.
- **`SYNC_ENABLED` kill-switch** still gates real syncs (see the gestek-sync incident memory). Task 11 Step 3 requires it on.
- **`pendente` semantics:** verified that `pendente=false` reflects a real staff "attended/resolved" action, not just elapsed time (a fully-past month had a few rows still `pendente=true`). Only `pendente === false` counts.
