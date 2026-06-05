# Native Gestek Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the n8n-webhook sync with a native in-app sync that calls the Gestek API directly and upserts into Supabase, with the patient-matching bug fixed (match on `gestek_id`, not `Clientes.id`) and locked by tests.

**Architecture:** Pure, TDD'd modules (`match.ts`, `sales.ts`) + an injectable Gestek API client (`gestek-client.ts`) + a thin Supabase data-access layer (`store.ts`) + an orchestrator (`run-sync.ts`) with a safety guard and dry-run. Patient metrics become compute-on-read via a `clientes_view` migration. The existing `/api/sync` route + button (behind `SYNC_ENABLED`) call the native sync.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Vitest 4 (jsdom, globals), `@supabase/supabase-js` service client, Gestek REST API.

**Reference (read before coding):** spec [docs/superpowers/specs/2026-06-04-native-gestek-sync-design.md](../specs/2026-06-04-native-gestek-sync-design.md). Source logic to port: [n8n/code-nodes/01_build_clientes_map.js](../../../n8n/code-nodes/01_build_clientes_map.js), [02_split_patients.js](../../../n8n/code-nodes/02_split_patients.js), [04_aggregate_sales.js](../../../n8n/code-nodes/04_aggregate_sales.js), and the "Build Vendas Rows" node in `Integrallys - Supabase Vendas Upsert (1).json`. Test style: [src/features/sync/trigger.test.ts](../../../src/features/sync/trigger.test.ts). `server-only` is stubbed for vitest in [vitest.config.ts](../../../vitest.config.ts).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/sync/types.ts` (create) | Shared types: Gestek payloads, row shapes, `SyncResult/Summary/Warning`. |
| `src/features/sync/match.ts` (create) | Pure: `normalizeName`, `splitPatients` (match on `gestek_id`). |
| `src/features/sync/sales.ts` (create) | Pure: `buildProcedimentos`, `mapVendaToRow`. |
| `src/features/sync/gestek-client.ts` (create) | `server-only`: paginated `fetchAllClientes` / `fetchAllVendas`. |
| `src/features/sync/store.ts` (create) | `server-only`: Supabase reads/writes + sync-log. Thin; live-verified. |
| `src/features/sync/run-sync.ts` (create) | `server-only`: orchestrator (guard, dry-run, summary). |
| `db/migrations/010_clientes_view_computed_metrics.sql` (create) | Compute-on-read `clientes_view`. User applies. |
| `src/app/api/sync/route.ts` (modify) | Call `runGestekSync` (native), read `?dryRun`. |
| `src/features/sync/sync-button.tsx` (modify) | Show native summary counts; import types from `types.ts`. |
| `src/features/sync/trigger.ts` + `trigger.test.ts` (delete) | n8n-webhook version, superseded. |
| `.env` + `.env.local.example` (modify) | Add `GESTEK_API_TOKEN`, `GESTEK_SYNC_START_DATE`. |

---

## Task 1: Shared types + env

**Files:**
- Create: `src/features/sync/types.ts`
- Modify: `src/features/sync/sync-button.tsx`, `src/features/sync/trigger.ts`, `.env`, `.env.local.example`

- [ ] **Step 1: Create `src/features/sync/types.ts`**

```ts
// Gestek API payloads (field names confirmed from the n8n "Build Vendas Rows" node)
export type GestekCliente = { id: string; nome?: string; dataCriacao?: string };
export type GestekVendaItem = { nome?: string; quantidade?: number | string };
export type GestekVenda = {
  id: string; codigo?: number; data?: string; cliente?: string; clienteId?: string;
  status?: number; subtotal?: number; desconto?: number; valorDesconto?: number;
  tipoDesconto?: number; total?: number; valorPago?: number; valorTaxasCartao?: number;
  profissional?: string; observacoes?: string; itens?: GestekVendaItem[]; pagamentos?: unknown[];
  dataCriacao?: string; dataUltimaAlteracao?: string;
};

// Supabase shapes
export type SupabasePatient = { id: string; Nome?: string; gestek_id?: string | null };
export type NewPatientRow = { id: string; gestek_id: string; Nome: string; "Data do Cadastro": string };
export type GestekVendaRow = {
  id: string; codigo: number | null; data: string | null; cliente: string | null;
  cliente_gestek_id: string | null; cliente_supabase_id: string | null; status: number | null;
  procedimentos: string | null; subtotal: number | null; desconto: number | null;
  valor_desconto: number | null; tipo_desconto: number | null; total: number | null;
  valor_pago: number | null; valor_taxas_cartao: number | null; profissional: string | null;
  observacoes: string | null; itens: unknown[]; pagamentos: unknown[];
  data_criacao: string | null; data_ultima_alteracao: string | null;
};

export type SyncSummary = {
  run_id?: string; mode?: string; dryRun?: boolean;
  total_clientes?: number; patients_inserted?: number; vendas_upserted?: number;
  orphan_supabase_patients?: number; duplicate_name_warnings?: number;
  started_at?: string; completed_at?: string;
  [k: string]: unknown;
};
export type SyncWarning = { level?: string; message?: string };
export type SyncResult =
  | { ok: true; summary: SyncSummary | null; warnings: SyncWarning[] }
  | { ok: false; code: "disabled" | "not_configured" | "guard_tripped" | "gestek_error" | "error"; message: string; summary?: SyncSummary };
```

- [ ] **Step 2: Point `trigger.ts` at the shared types (keeps build green until Task 8 deletes it)**

Replace the type definitions block in `src/features/sync/trigger.ts` (the `export type SyncSummary`, `SyncWarning`, `SyncResult` declarations) with a re-export:
```ts
export type { SyncSummary, SyncWarning, SyncResult } from "./types";
```
Leave the rest of `trigger.ts` (the `normalizeSyncBody` / `triggerGestekSync` functions) as-is.

- [ ] **Step 3: Update `sync-button.tsx` import**

In `src/features/sync/sync-button.tsx`, change:
```ts
import type { SyncResult, SyncSummary } from "./trigger";
```
to:
```ts
import type { SyncResult, SyncSummary } from "./types";
```

- [ ] **Step 4: Add env vars**

Append to `.env` (gitignored):
```
GESTEK_API_TOKEN=
GESTEK_SYNC_START_DATE=2024-01-01
```
Append to `.env.local.example`:
```
# Gestek API (native sync)
GESTEK_API_TOKEN=
GESTEK_SYNC_START_DATE=2024-01-01
```

- [ ] **Step 5: Verify + commit**

Run: `npm test && npm run build 2>&1 | grep -iE "compiled|error" | head -3`
Expected: 40 tests pass; "✓ Compiled successfully".
```bash
git add src/features/sync/types.ts src/features/sync/trigger.ts src/features/sync/sync-button.tsx .env.local.example
git commit -m "feat(sync): shared types module + Gestek env vars"
```

---

## Task 2: `match.ts` — patient matching (TDD, the bug fix)

**Files:**
- Create: `src/features/sync/match.ts`
- Test: `src/features/sync/match.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sync/match.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeName, splitPatients } from "./match";
import type { GestekCliente, SupabasePatient } from "./types";

describe("normalizeName", () => {
  it("trims, collapses spaces, strips accents, lowercases", () => {
    expect(normalizeName("  José   DA Silva ")).toBe("jose da silva");
  });
  it("handles null/undefined", () => {
    expect(normalizeName(undefined)).toBe("");
  });
});

describe("splitPatients", () => {
  // THE BUG: Supabase originals have numeric ids; the Gestek id is in gestek_id.
  // Matching MUST be on gestek_id, never on Clientes.id.
  it("treats Gestek clients already present (by gestek_id) as NOT new", () => {
    const gestek: GestekCliente[] = [
      { id: "aaa111", nome: "ANA" },
      { id: "bbb222", nome: "BRUNO" },
    ];
    const supa: SupabasePatient[] = [
      { id: "12", Nome: "ANA", gestek_id: "aaa111" },
      { id: "37", Nome: "BRUNO", gestek_id: "bbb222" },
    ];
    const r = splitPatients(gestek, supa);
    expect(r.newGestekClients).toEqual([]); // <- would be BOTH if matched on Clientes.id
    expect(r.gestekIdToSupabaseId).toEqual({ aaa111: "12", bbb222: "37" });
  });
  it("flags a genuinely-new Gestek client", () => {
    const gestek: GestekCliente[] = [{ id: "aaa111", nome: "ANA" }, { id: "ccc333", nome: "CARLA" }];
    const supa: SupabasePatient[] = [{ id: "12", Nome: "ANA", gestek_id: "aaa111" }];
    const r = splitPatients(gestek, supa);
    expect(r.newGestekClients.map((c) => c.id)).toEqual(["ccc333"]);
  });
  it("reports orphans (Supabase has gestek_id not in Gestek)", () => {
    const r = splitPatients([{ id: "aaa111", nome: "ANA" }], [
      { id: "12", Nome: "ANA", gestek_id: "aaa111" },
      { id: "99", Nome: "GHOST", gestek_id: "zzz999" },
    ]);
    expect(r.orphans).toEqual([{ id: "99", Nome: "GHOST" }]);
  });
  it("warns on duplicate normalized names among Gestek clients", () => {
    const r = splitPatients([{ id: "a", nome: "ANA" }, { id: "b", nome: "ana" }], []);
    expect(r.duplicates.length).toBe(1);
  });
  it("builds a supabaseNameToId map (first wins)", () => {
    const r = splitPatients([], [{ id: "5", Nome: "ANA", gestek_id: "x" }]);
    expect(r.supabaseNameToId).toEqual({ ana: "5" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/sync/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`.

- [ ] **Step 3: Implement `src/features/sync/match.ts`**

```ts
import type { GestekCliente, SupabasePatient, SyncWarning } from "./types";

export function normalizeName(s: string | null | undefined): string {
  return (s || "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type SplitResult = {
  newGestekClients: GestekCliente[];
  existingGestekIds: string[];
  gestekIdToSupabaseId: Record<string, string>;
  supabaseNameToId: Record<string, string>;
  orphans: { id: string; Nome?: string }[];
  duplicates: SyncWarning[];
};

export function splitPatients(gestekClients: GestekCliente[], supabasePatients: SupabasePatient[]): SplitResult {
  const existing = new Set<string>();
  const gestekIdToSupabaseId: Record<string, string> = {};
  const supabaseNameToId: Record<string, string> = {};
  for (const p of supabasePatients) {
    if (p.gestek_id) { existing.add(p.gestek_id); gestekIdToSupabaseId[p.gestek_id] = p.id; }
    const nk = normalizeName(p.Nome);
    if (nk && !supabaseNameToId[nk]) supabaseNameToId[nk] = p.id;
  }

  const gestekIdSet = new Set(gestekClients.map((c) => c.id));
  const orphans = supabasePatients
    .filter((p) => p.gestek_id && !gestekIdSet.has(p.gestek_id))
    .map((p) => ({ id: p.id, Nome: p.Nome }));

  const seenName = new Set<string>();
  const duplicates: SyncWarning[] = [];
  const newGestekClients: GestekCliente[] = [];
  for (const c of gestekClients) {
    if (!c.id) continue;
    const nk = normalizeName(c.nome);
    if (nk) {
      if (seenName.has(nk)) duplicates.push({ level: "warn", message: `Duplicate Gestek name "${nk}" (${c.nome})` });
      else seenName.add(nk);
    }
    if (!existing.has(c.id)) newGestekClients.push(c); // match on gestek_id only
  }

  return { newGestekClients, existingGestekIds: [...existing], gestekIdToSupabaseId, supabaseNameToId, orphans, duplicates };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/features/sync/match.test.ts`
Expected: PASS (all in both describes).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/match.ts src/features/sync/match.test.ts
git commit -m "feat(sync): patient matching on gestek_id (TDD; fixes mass-dup root cause)"
```

---

## Task 3: `sales.ts` — venda → row mapping (TDD)

**Files:**
- Create: `src/features/sync/sales.ts`
- Test: `src/features/sync/sales.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sync/sales.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildProcedimentos, mapVendaToRow } from "./sales";
import type { GestekVenda } from "./types";

describe("buildProcedimentos", () => {
  it("formats items as 'Nome (qty)', sorted by qty desc", () => {
    expect(buildProcedimentos([{ nome: "BOTOX", quantidade: 1 }, { nome: "PREENCHIMENTO", quantidade: 3 }]))
      .toBe("PREENCHIMENTO (3), BOTOX (1)");
  });
  it("returns null for empty", () => {
    expect(buildProcedimentos([])).toBeNull();
  });
});

describe("mapVendaToRow", () => {
  const venda: GestekVenda = {
    id: "v1", codigo: 9, data: "2025-08-01T17:00:00Z", cliente: "ANA", clienteId: "aaa111",
    status: 1, subtotal: 100.005, desconto: 10, valorDesconto: 0, tipoDesconto: 1, total: 90,
    valorPago: 90, valorTaxasCartao: 2, profissional: "DR", observacoes: "x",
    itens: [{ nome: "BOTOX", quantidade: 2 }], pagamentos: [{ forma: "pix" }],
    dataCriacao: "2025-08-01T10:00:00Z", dataUltimaAlteracao: "0001-01-01T00:00:00Z",
  };
  it("maps fields + resolves cliente_supabase_id via the gestek_id map", () => {
    const row = mapVendaToRow(venda, { aaa111: "12" });
    expect(row.id).toBe("v1");
    expect(row.cliente_gestek_id).toBe("aaa111");
    expect(row.cliente_supabase_id).toBe("12");
    expect(row.subtotal).toBe(100.01); // rounded to 2dp
    expect(row.procedimentos).toBe("BOTOX (2)");
    expect(row.data_ultima_alteracao).toBeNull(); // 0001 sentinel -> null
    expect(row.data_criacao).toBe("2025-08-01T10:00:00Z");
  });
  it("falls back to name map when gestek_id not matched", () => {
    const row = mapVendaToRow(venda, {}, { ana: "55" });
    expect(row.cliente_supabase_id).toBe("55");
  });
  it("sets cliente_supabase_id null when unresolved", () => {
    const row = mapVendaToRow(venda, {}, {});
    expect(row.cliente_supabase_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/sync/sales.test.ts`
Expected: FAIL — `Failed to resolve import "./sales"`.

- [ ] **Step 3: Implement `src/features/sync/sales.ts`**

```ts
import type { GestekVenda, GestekVendaItem, GestekVendaRow } from "./types";
import { normalizeName } from "./match";

const num = (n: unknown): number | null => (n == null ? null : Math.round(Number(n) * 100) / 100);
const ts = (s: unknown): string | null => (s && !String(s).startsWith("0001") ? String(s) : null);

export function buildProcedimentos(itens: GestekVendaItem[] | undefined): string | null {
  return (
    (itens || [])
      .map((it) => [it.nome, Number(it.quantidade) || 0] as [string | undefined, number])
      .filter(([n]) => n)
      .sort((a, b) => b[1] - a[1])
      .map(([n, q]) => `${n} (${q})`)
      .join(", ") || null
  );
}

export function mapVendaToRow(
  v: GestekVenda,
  gestekIdToSupabaseId: Record<string, string>,
  supabaseNameToId: Record<string, string> = {},
): GestekVendaRow {
  const supaId =
    (v.clienteId && gestekIdToSupabaseId[v.clienteId]) ||
    supabaseNameToId[normalizeName(v.cliente)] ||
    null;
  return {
    id: v.id,
    codigo: v.codigo ?? null,
    data: ts(v.data),
    cliente: v.cliente ?? null,
    cliente_gestek_id: v.clienteId ?? null,
    cliente_supabase_id: supaId,
    status: v.status ?? null,
    procedimentos: buildProcedimentos(v.itens),
    subtotal: num(v.subtotal),
    desconto: num(v.desconto),
    valor_desconto: num(v.valorDesconto),
    tipo_desconto: v.tipoDesconto ?? null,
    total: num(v.total),
    valor_pago: num(v.valorPago),
    valor_taxas_cartao: num(v.valorTaxasCartao),
    profissional: v.profissional ?? null,
    observacoes: v.observacoes ?? null,
    itens: v.itens ?? [],
    pagamentos: v.pagamentos ?? [],
    data_criacao: ts(v.dataCriacao),
    data_ultima_alteracao: ts(v.dataUltimaAlteracao),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/features/sync/sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/sales.ts src/features/sync/sales.test.ts
git commit -m "feat(sync): Gestek venda -> gestek_vendas row mapping (TDD)"
```

---

## Task 4: `gestek-client.ts` — paginated API client (TDD)

**Files:**
- Create: `src/features/sync/gestek-client.ts`
- Test: `src/features/sync/gestek-client.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sync/gestek-client.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllClientes, fetchAllVendas } from "./gestek-client";

const page = (key: string, items: unknown[]) =>
  new Response(JSON.stringify([{ [key]: items }]), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => { process.env.GESTEK_API_TOKEN = "tok"; });

describe("fetchAllClientes", () => {
  it("paginates until a page has < 100 and sends Bearer auth", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, nome: `N${i}` }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page("clientes", full))
      .mockResolvedValueOnce(page("clientes", [{ id: "last", nome: "Z" }]));
    const out = await fetchAllClientes(fetchMock as unknown as typeof fetch);
    expect(out).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/clientes");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });
  it("throws on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchAllClientes(fetchMock as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("fetchAllVendas", () => {
  it("sends Status=1 + date window and paginates", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page("vendas", [{ id: "v1", clienteId: "c1" }]));
    const out = await fetchAllVendas("2024-01-01", fetchMock as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/vendas");
    expect(String(url)).toContain("Status=1");
    expect(String(url)).toContain("DataInicio=2024-01-01");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/sync/gestek-client.test.ts`
Expected: FAIL — `Failed to resolve import "./gestek-client"`.

- [ ] **Step 3: Implement `src/features/sync/gestek-client.ts`**

```ts
import "server-only";
import type { GestekCliente, GestekVenda } from "./types";

const BASE = "https://apipublica.gestek.com.br/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 60;

function authHeaders() {
  const token = process.env.GESTEK_API_TOKEN;
  if (!token) throw new Error("GESTEK_API_TOKEN not set");
  return { Authorization: `Bearer ${token}` };
}

function unwrap<T>(body: unknown, key: string): T[] {
  let p = body as Record<string, unknown> | unknown[];
  if (Array.isArray(p)) p = p[0] as Record<string, unknown>;
  const arr = (p as Record<string, unknown>)?.[key];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

async function fetchPaged<T>(path: string, key: string, extraQuery: Record<string, string>, fetchImpl: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  for (let pageN = 1; pageN <= MAX_PAGES; pageN++) {
    const qs = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(pageN), ...extraQuery });
    const res = await fetchImpl(`${BASE}${path}?${qs.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Gestek ${path} returned ${res.status}`);
    const items = unwrap<T>(await res.json(), key);
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

export function fetchAllClientes(fetchImpl: typeof fetch = fetch): Promise<GestekCliente[]> {
  return fetchPaged<GestekCliente>("/clientes", "clientes", {}, fetchImpl);
}

export function fetchAllVendas(startISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekVenda[]> {
  const end = new Date().toISOString().slice(0, 10);
  return fetchPaged<GestekVenda>("/vendas", "vendas", { DataInicio: startISO, DataFim: end, Status: "1" }, fetchImpl);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/features/sync/gestek-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/gestek-client.ts src/features/sync/gestek-client.test.ts
git commit -m "feat(sync): paginated Gestek API client (TDD)"
```

---

## Task 5: `store.ts` — Supabase data access (thin, server-only)

**Files:**
- Create: `src/features/sync/store.ts`

> No unit test (thin DB wrapper, covered by live verification in Task 9). Uses the existing service client factory `createSupabaseServiceClient` from [src/lib/supabase/server.ts](../../../src/lib/supabase/server.ts).

- [ ] **Step 1: Implement `src/features/sync/store.ts`**

```ts
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabasePatient, NewPatientRow, GestekVendaRow, SyncSummary, SyncWarning } from "./types";

export type SyncStore = {
  readPatients(): Promise<SupabasePatient[]>;
  insertPatients(rows: NewPatientRow[]): Promise<void>;
  upsertVendas(rows: GestekVendaRow[]): Promise<void>;
  logStart(meta: { run_id: string; started_at: string; trigger: string; mode: string }): Promise<void>;
  logComplete(run_id: string, completed_at: string, summary: SyncSummary, warnings: SyncWarning[]): Promise<void>;
  logError(run_id: string, completed_at: string, message: string): Promise<void>;
};

export function createSyncStore(): SyncStore {
  const sb = createSupabaseServiceClient();
  return {
    async readPatients() {
      const r = await sb.from("Clientes").select("id, Nome, gestek_id");
      if (r.error) throw r.error;
      return (r.data ?? []) as SupabasePatient[];
    },
    async insertPatients(rows) {
      if (!rows.length) return;
      const r = await sb.from("Clientes").insert(rows);
      if (r.error) throw r.error;
    },
    async upsertVendas(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const r = await sb.from("gestek_vendas").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (r.error) throw r.error;
      }
    },
    async logStart(meta) {
      await sb.from("gestek_sync_logs").insert({ ...meta });
    },
    async logComplete(run_id, completed_at, summary, warnings) {
      await sb.from("gestek_sync_logs").update({ completed_at, summary, warnings }).eq("run_id", run_id);
    },
    async logError(run_id, completed_at, message) {
      await sb.from("gestek_sync_logs").update({ completed_at, error: message }).eq("run_id", run_id);
    },
  };
}
```

- [ ] **Step 2: Verify compile + commit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "features/sync/store" || echo "no store type errors"`
Expected: `no store type errors`.
```bash
git add src/features/sync/store.ts
git commit -m "feat(sync): thin Supabase store for the sync"
```

---

## Task 6: `run-sync.ts` — orchestrator with guard + dry-run (TDD)

**Files:**
- Create: `src/features/sync/run-sync.ts`
- Test: `src/features/sync/run-sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sync/run-sync.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runGestekSync } from "./run-sync";
import type { SyncStore } from "./store";
import type { GestekCliente, GestekVenda, SupabasePatient } from "./types";

function makeStore(patients: SupabasePatient[]) {
  const inserted: unknown[] = [];
  const upserted: unknown[] = [];
  const store: SyncStore = {
    readPatients: async () => patients,
    insertPatients: async (rows) => { inserted.push(...rows); },
    upsertVendas: async (rows) => { upserted.push(...rows); },
    logStart: async () => {}, logComplete: async () => {}, logError: async () => {},
  };
  return { store, inserted, upserted };
}
const gestek = (clientes: GestekCliente[], vendas: GestekVenda[]) => ({
  fetchAllClientes: async () => clientes,
  fetchAllVendas: async () => vendas,
});

describe("runGestekSync", () => {
  const existing: SupabasePatient[] = Array.from({ length: 100 }, (_, i) => ({ id: String(i + 1), Nome: `P${i}`, gestek_id: `g${i}` }));

  it("happy path: inserts only new patients and upserts vendas", async () => {
    const { store, inserted, upserted } = makeStore(existing);
    const clientes = [...existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome })), { id: "gNEW", nome: "NEW ONE" }];
    const vendas: GestekVenda[] = [{ id: "v1", clienteId: "g0", status: 1, total: 100, itens: [] }];
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, vendas), now: () => new Date("2026-06-04T00:00:00Z") });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary?.patients_inserted).toBe(1);
      expect(r.summary?.vendas_upserted).toBe(1);
    }
    expect(inserted).toHaveLength(1);
    expect(upserted).toHaveLength(1);
  });

  it("dry-run writes nothing but reports the plan", async () => {
    const { store, inserted, upserted } = makeStore(existing);
    const clientes = [...existing.map((p) => ({ id: p.gestek_id!, nome: p.Nome })), { id: "gNEW", nome: "NEW ONE" }];
    const r = await runGestekSync({ dryRun: true }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.summary?.dryRun).toBe(true); expect(r.summary?.patients_inserted).toBe(1); }
    expect(inserted).toHaveLength(0);
    expect(upserted).toHaveLength(0);
  });

  it("guard trips on an implausible number of new patients (writes nothing)", async () => {
    const { store, inserted } = makeStore(existing);
    // every Gestek client looks new (none match existing gestek_id) -> 100 new
    const clientes = Array.from({ length: 100 }, (_, i) => ({ id: `brand${i}`, nome: `X${i}` }));
    const r = await runGestekSync({ dryRun: false }, { store, gestek: gestek(clientes, []), now: () => new Date() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("guard_tripped");
    expect(inserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- src/features/sync/run-sync.test.ts`
Expected: FAIL — `Failed to resolve import "./run-sync"`.

- [ ] **Step 3: Implement `src/features/sync/run-sync.ts`**

```ts
import "server-only";
import { randomUUID } from "node:crypto";
import type { GestekCliente, GestekVenda, NewPatientRow, SyncResult, SyncSummary, SyncWarning } from "./types";
import type { SyncStore } from "./store";
import { splitPatients } from "./match";
import { mapVendaToRow } from "./sales";
import { createSyncStore } from "./store";
import { fetchAllClientes, fetchAllVendas } from "./gestek-client";

export type GestekApi = {
  fetchAllClientes: () => Promise<GestekCliente[]>;
  fetchAllVendas: (startISO: string) => Promise<GestekVenda[]>;
};
export type RunDeps = { store: SyncStore; gestek: GestekApi; now?: () => Date };

// BRT-formatted "DD/MM/YY HH:MM" for the Clientes "Data do Cadastro" text column.
function fmtCadastro(dataCriacao?: string): string {
  const d = dataCriacao ? new Date(dataCriacao) : new Date();
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(brt.getUTCDate())}/${p(brt.getUTCMonth() + 1)}/${p(brt.getUTCFullYear() % 100)} ${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())}`;
}

export async function runGestekSync(opts: { dryRun?: boolean }, deps?: RunDeps): Promise<SyncResult> {
  const store = deps?.store ?? createSyncStore();
  const gestek = deps?.gestek ?? { fetchAllClientes, fetchAllVendas: (s: string) => fetchAllVendas(s) };
  const now = deps?.now ?? (() => new Date());
  const dryRun = !!opts.dryRun;

  const run_id = randomUUID();
  const started_at = now().toISOString();
  let clientes: GestekCliente[];
  try {
    if (!dryRun) await store.logStart({ run_id, started_at, trigger: "app", mode: "sync" });
    clientes = await gestek.fetchAllClientes();
  } catch (e) {
    return { ok: false, code: "gestek_error", message: e instanceof Error ? e.message : "Gestek fetch failed" };
  }

  const patients = await store.readPatients();
  const split = splitPatients(clientes, patients);

  // Safety guard: never mass-insert (the prior n8n incident). Only applies once we already have data.
  const limit = Math.max(15, Math.round(patients.length * 0.15));
  if (patients.length >= 50 && split.newGestekClients.length > limit) {
    const completed_at = now().toISOString();
    if (!dryRun) await store.logError(run_id, completed_at, `guard: ${split.newGestekClients.length} new > ${limit}`);
    return {
      ok: false, code: "guard_tripped",
      message: `Aborted: ${split.newGestekClients.length} new patients exceeds the safe limit of ${limit}. Matching may be broken — nothing was written.`,
      summary: { run_id, dryRun, total_clientes: clientes.length, patients_inserted: split.newGestekClients.length },
    };
  }

  const newRows: NewPatientRow[] = split.newGestekClients.map((c: GestekCliente) => ({
    id: c.id, gestek_id: c.id, Nome: c.nome ?? "", "Data do Cadastro": fmtCadastro(c.dataCriacao),
  }));
  if (!dryRun) await store.insertPatients(newRows);

  // gestek_id -> Supabase id, including patients we just inserted (id === gestek_id for new rows)
  const idMap: Record<string, string> = { ...split.gestekIdToSupabaseId };
  for (const r of newRows) idMap[r.gestek_id] = r.id;

  const startISO = process.env.GESTEK_SYNC_START_DATE || "2024-01-01";
  const vendas = await gestek.fetchAllVendas(startISO);
  const vendaRows = vendas.filter((v) => v.id).map((v) => mapVendaToRow(v, idMap, split.supabaseNameToId));
  if (!dryRun) await store.upsertVendas(vendaRows);

  const completed_at = now().toISOString();
  const warnings: SyncWarning[] = split.duplicates;
  const summary: SyncSummary = {
    run_id, mode: "sync", dryRun, started_at, completed_at,
    total_clientes: clientes.length, patients_inserted: newRows.length, vendas_upserted: vendaRows.length,
    orphan_supabase_patients: split.orphans.length, duplicate_name_warnings: split.duplicates.length,
  };
  if (!dryRun) await store.logComplete(run_id, completed_at, summary, warnings);
  return { ok: true, summary, warnings };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- src/features/sync/run-sync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/run-sync.ts src/features/sync/run-sync.test.ts
git commit -m "feat(sync): native sync orchestrator with guard + dry-run (TDD)"
```

---

## Task 7: `clientes_view` compute-on-read migration

**Files:**
- Create: `db/migrations/010_clientes_view_computed_metrics.sql`

> File only — the user applies it in Supabase (like prior migrations). Computes the 4 metric columns from `gestek_vendas` instead of reading stored `Clientes` text columns. Keeps every existing output column name + type so the dashboard is unaffected.

- [ ] **Step 1: Write the migration**

Create `db/migrations/010_clientes_view_computed_metrics.sql`:
```sql
-- Compute patient metrics live from gestek_vendas (status=1) instead of the
-- stored "Numero de Vendas"/"Receita Total"/... text columns on Clientes.
-- Same output columns/types as before, so the dashboard is unaffected.
create or replace view clientes_view as
select
  c.id,
  c."Nome"               as nome,
  c."Telefone Principal" as telefone,
  c."Email Principal"    as email,
  c."Origem"             as origem,
  c."Procedimentos"      as procedimentos_raw,
  coalesce(v.numero_vendas, 0)                          as numero_vendas,
  coalesce(v.receita_total, 0)::numeric                 as receita_total,
  coalesce(v.descontos, 0)::numeric                     as descontos,
  case when coalesce(v.numero_vendas,0) > 0
       then (v.receita_total / v.numero_vendas)::numeric
       else 0::numeric end                              as ticket_medio,
  c."Data do Cadastro"                                  as cadastro_raw,
  to_timestamp(nullif(btrim(c."Data do Cadastro"), ''), 'DD/MM/YY HH24:MI') as cadastro_at
from "Clientes" c
left join (
  select cliente_supabase_id,
         count(*)        as numero_vendas,
         sum(total)      as receita_total,
         sum(desconto)   as descontos
  from gestek_vendas
  where status = 1 and cliente_supabase_id is not null
  group by cliente_supabase_id
) v on v.cliente_supabase_id = c.id;
```

- [ ] **Step 2: Commit (user applies it in Supabase before Task 9 live run)**

```bash
git add db/migrations/010_clientes_view_computed_metrics.sql
git commit -m "feat(db): clientes_view computes metrics from gestek_vendas (010)"
```

---

## Task 8: Wire the route + button to the native sync

**Files:**
- Modify: `src/app/api/sync/route.ts`, `src/features/sync/sync-button.tsx`
- Delete: `src/features/sync/trigger.ts`, `src/features/sync/trigger.test.ts`

- [ ] **Step 1: Rewrite `src/app/api/sync/route.ts`**

```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runGestekSync } from "@/features/sync/run-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export function isSyncEnabled() {
  return process.env.SYNC_ENABLED === "true";
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (!isSyncEnabled()) {
    return Response.json({ ok: false, code: "disabled", message: "Sync is temporarily disabled." }, { status: 503 });
  }

  const result = await runGestekSync({ dryRun });
  const status = result.ok ? 200 : result.code === "guard_tripped" ? 409 : 502;
  return Response.json(result, { status });
}
```

- [ ] **Step 2: Update the button's success display**

In `src/features/sync/sync-button.tsx`, replace the success line inside the `phase === "done"` block:
```tsx
            ✓ Synced — {fmt(summary?.patients_updated)} updated, {fmt(summary?.new_patients_inserted)} new,{" "}
```
with:
```tsx
            ✓ Synced — {fmt(summary?.patients_inserted)} new patients, {fmt(summary?.vendas_upserted)} sales,{" "}
```

- [ ] **Step 3: Delete the superseded n8n trigger**

```bash
git rm src/features/sync/trigger.ts src/features/sync/trigger.test.ts
```

- [ ] **Step 4: Verify build + tests**

Run: `npm test && npm run build 2>&1 | grep -iE "compiled|error|/api/sync" | head -5`
Expected: tests pass (match/sales/gestek-client/run-sync suites; trigger suite gone); "✓ Compiled successfully"; `/api/sync` listed.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sync/route.ts src/features/sync/sync-button.tsx
git commit -m "feat(sync): wire /api/sync + button to native runGestekSync; drop n8n trigger"
```

---

## Task 9: Verification (tests, build, live dry-run, live real run)

**Files:** none

- [ ] **Step 1: Unit tests + build green**

Run: `npm test && npm run build 2>&1 | tail -3`
Expected: all suites pass; build succeeds.

- [ ] **Step 2: Pre-reqs for live run**

Confirm the user has (a) added `GESTEK_API_TOKEN` to `.env`, and (b) applied `db/migrations/010_...sql` in Supabase. Verify the view still serves the dashboard:
```bash
node --env-file=.env -e 'import("@supabase/supabase-js").then(async({createClient})=>{const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const r=await sb.from("clientes_view").select("id,numero_vendas,receita_total").limit(3);console.log(r.error?r.error.message:JSON.stringify(r.data));const rev=await sb.rpc("run_readonly_select",{q:"select sum(receita_total)::numeric t from clientes_view"});console.log("Σreceita_total:",JSON.stringify(rev.data));})'
```
Expected: rows print; `Σreceita_total` ≈ `424038.95` (matches `vendas_view`).

- [ ] **Step 3: Live DRY-RUN via the route (writes nothing)**

> Run the dev server with `SYNC_ENABLED=true` and hit `/api/sync?dryRun=1` while logged in. Confirms Gestek auth + the plan without touching data.

Create `/tmp/verify_sync_dryrun.py` modeled on `/tmp/verify_sync.py` (login, then `pg.evaluate` a `fetch('/api/sync?dryRun=1', {method:'POST'})`, print the JSON). Run:
```bash
SYNC_ENABLED=true python3 "/Users/matheusbredapolezi/.claude/skills/webapp-testing/scripts/with_server.py" --server "npm run dev" --port 3000 --timeout 90 -- python3 /tmp/verify_sync_dryrun.py
```
Expected: `{ ok: true, summary: { dryRun: true, patients_inserted: <small>, vendas_upserted: <~838> } }`. **If `patients_inserted` is large (~hundreds), STOP** — matching is wrong; do not do a real run.

- [ ] **Step 4: Live REAL run + verify no mass-insert**

Capture the patient count, run the real sync once (`SYNC_ENABLED=true`, no `dryRun`), and re-check:
```bash
node --env-file=.env -e 'import("@supabase/supabase-js").then(async({createClient})=>{const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const c=await sb.from("Clientes").select("id",{count:"exact",head:true});console.log("before:",c.count);})'
```
Then trigger the real run (Playwright button click or a direct authed POST), then:
```bash
node --env-file=.env -e 'import("@supabase/supabase-js").then(async({createClient})=>{const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});const c=await sb.from("Clientes").select("id",{count:"exact",head:true});const v=await sb.from("gestek_vendas").select("id",{count:"exact",head:true});const rev=await sb.rpc("run_readonly_select",{q:"select sum(receita_total)::numeric t from clientes_view"});console.log("after patients:",c.count,"| vendas:",v.count,"| Σreceita:",JSON.stringify(rev.data));})'
```
Expected: patient count ≈ before (only genuinely-new added, all with `gestek_id`); vendas ≈ 838+; revenue still sane. Run the real sync a **2nd** time → `patients_inserted: 0`, `vendas_upserted` same (idempotent).

- [ ] **Step 5: Update HANDOFF.md + memory**

Mark native sync done; note `SYNC_ENABLED` can stay `true` (the guard + gestek_id matching make it safe); update the incident memory to reflect the fix. Commit:
```bash
git add HANDOFF.md
git commit -m "docs: native Gestek sync live + verified"
```

---

## Self-Review notes

- **Spec coverage:** gestek-client (Task 4), match/gestek_id fix (Task 2), sales mapping (Task 3), orchestrator+guard+dryRun (Task 6), store (Task 5), compute-on-read view (Task 7), route+button rewire & n8n removal (Task 8), env+types (Task 1), TDD + dry-run-first live verification (Task 9). All covered.
- **Type consistency:** `SyncResult`/`SyncSummary` (Task 1) used unchanged in run-sync (Task 6), store (Task 5), route/button (Task 8). `splitPatients` return shape (Task 2) consumed in run-sync (Task 6). `mapVendaToRow(v, idMap, nameMap)` signature consistent between Tasks 3 and 6. Summary fields `patients_inserted`/`vendas_upserted` consistent between Tasks 6 and 8.
- **No placeholders:** every code/command step is complete.
- **Safety:** matching on `gestek_id` (Task 2 test reproduces the exact bug), insert guard (Task 6 test), dry-run-first live (Task 9). The `SYNC_ENABLED` gate stays.
