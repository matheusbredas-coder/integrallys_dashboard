# Design — Native Gestek Sync (replace n8n)

**Date:** 2026-06-04
**Branch:** `build/foundation`
**Supersedes:** the n8n-webhook sync from `2026-06-04-gestek-sync-button-design.md`.

## 1. Problem & goal

The dashboard's "Sync Gestek" button currently calls an n8n webhook. That n8n worker
**mass-duplicated patients** (inserted 100 dup rows in a live test, since reverted) because
its matching code (`n8n/code-nodes/02_split_patients.js`) matches Gestek clients to Supabase
patients **by `Clientes.id`**, assuming `Clientes.id` *is* the Gestek id. The real `Clientes`
table uses **numeric ids (1–330)** for the originals with the Gestek id in a separate
**`gestek_id`** column — so the comparison found zero matches and treated every Gestek client
as new. The sync is currently gated off (`SYNC_ENABLED`).

**Goal:** replace the n8n dependency with a **native in-app sync** — a server-side routine that
calls the Gestek API directly and upserts into Supabase, with the matching bug fixed and locked
by tests. The dashboard "Sync Gestek" button (re-enabled) triggers it.

## 2. Key decisions (from brainstorming)

- **Native TypeScript sync** in the Next app (not a Supabase Edge Function); full fetch each run
  (fits current size in one 60s function); incremental sync is a future option.
- **Compute-on-read metrics:** the sync does **not** write patient totals back to `Clientes`.
  Instead `clientes_view` is changed to compute `numero_vendas / receita_total / descontos /
  ticket_medio` live from `gestek_vendas`. Removes the most error-prone step; totals always match
  sales.
- **Trigger:** the manual button now; Vercel Cron is a later follow-up (out of scope).
- **Gestek auth:** static Bearer token in `GESTEK_API_TOKEN` (env).

## 3. Gestek API (confirmed from n8n nodes)

Base `https://apipublica.gestek.com.br/api`, header `Authorization: Bearer ${GESTEK_API_TOKEN}`.
- `GET /clientes?Limit=100&Page=N` → body `[{ clientes: [{ id, nome, dataCriacao, ... }], totais }]`
  (may be array-wrapped or bare object). Paginate `Page` from 1; stop when a page's
  `clientes.length < 100`.
- `GET /vendas?DataInicio=&DataFim=&Status=1&Limit=100&Page=N` → body
  `[{ vendas: [{ id, codigo, data, clienteId, cliente, status, total, valor_pago, desconto,
  subtotal, itens: [{ nome, quantidade }], pagamentos, ... }], totais }]`. Same pagination.
  Full sync fetches one wide window (configurable start date → today); if the API caps a window,
  fall back to monthly windows.

## 4. Components (all under `src/features/sync/`)

### `gestek-client.ts` (`server-only`)
- `fetchAllClientes(fetchImpl?)` → `GestekCliente[]` (`{ id, nome, dataCriacao }`). Paginates,
  unwraps array/bare body, Bearer auth, throws on non-2xx.
- `fetchAllVendas(startISO, fetchImpl?)` → `GestekVenda[]`. Same pagination, Status=1.
- Injectable `fetchImpl` for tests.

### `match.ts` (pure, TDD)
- `normalizeName(s)` — trim/collapse-space/strip-accents/lowercase (ported from
  `01_build_clientes_map.js`).
- `splitPatients(gestekClients, supabasePatients)` where `supabasePatients: { id, Nome,
  gestek_id }[]`. Builds a set of **existing `gestek_id`s**; a Gestek client is *new* iff its
  `id` is not in that set. Returns `{ newGestekClients, existingGestekIds, orphans, duplicates }`.
  Detects normalized-name duplicates among Gestek clients (passthrough warnings).
- **THE FIX:** matching is on `gestek_id`, never on `Clientes.id`.

### `sales.ts` (pure, TDD)
- `buildProcedimentos(itens)` → readable `"Nome (qty), ..."` text.
- `mapVendaToRow(venda, gestekIdToSupabaseId)` → a `gestek_vendas` row matching its DDL
  (`id, codigo, data, cliente, cliente_gestek_id, cliente_supabase_id, status, procedimentos,
  subtotal, desconto, total, valor_pago, itens, pagamentos, data_criacao, ...`).
  `cliente_supabase_id = gestekIdToSupabaseId[venda.clienteId] ?? null`.

### `run-sync.ts` (`server-only`) — orchestrator
`runGestekSync({ dryRun }): Promise<SyncResult>`:
1. Insert `gestek_sync_logs` "started" row (`run_id`, `started_at`, `trigger:"app"`, `mode:"sync"`).
2. `fetchAllClientes()`.
3. Read `Clientes` `(id, Nome, gestek_id)` via service client.
4. `splitPatients(...)` → `newGestekClients`.
5. **Safety guard:** if `newGestekClients.length > max(25, existing*0.2)` → abort: write nothing,
   mark log errored, return `{ ok:false, code:"guard_tripped", message, summary }`.
6. If not `dryRun`: insert new patients into `Clientes` with **`gestek_id` set** (`id = c.id`,
   `gestek_id = c.id`, `Nome`, `Data do Cadastro` formatted BRT — ported from the n8n insert,
   plus the `gestek_id` it omitted).
7. `fetchAllVendas(startISO)`; build `gestekId→supabaseId` map (existing + newly inserted);
   `mapVendaToRow` each.
8. If not `dryRun`: upsert rows into `gestek_vendas` (`onConflict: id`, batched).
9. Build summary `{ patients_inserted, vendas_upserted, total_clientes, orphans,
   duplicate_name_warnings, dryRun }`; update log "completed".
10. Return `{ ok:true, summary, warnings }` (existing `SyncResult` shape; button unchanged).

### `db/migrations/010_clientes_view_computed_metrics.sql`
Recreate `clientes_view` keeping every current column, but compute the four metric columns from
`gestek_vendas` (`join on cliente_supabase_id = "Clientes".id`, `status = 1`):
`numero_vendas = count(*)`, `receita_total = sum(total)`, `descontos = sum(desconto)`,
`ticket_medio = receita_total / nullif(numero_vendas,0)`. Applied by the user in Supabase. After
this, the dashboard's patient metrics auto-track `gestek_vendas`.

### Wiring
- `src/app/api/sync/route.ts`: keep auth gate + `SYNC_ENABLED` gate; call `runGestekSync()`
  (read `dryRun` from `?dryRun=1`). Drop the n8n webhook path.
- `src/features/sync/trigger.ts`: replaced by `run-sync.ts`; keep/extend the `SyncResult` type
  (add `guard_tripped` code, summary fields `patients_inserted` / `vendas_upserted`).
- `src/features/sync/sync-button.tsx`: show native summary counts; otherwise unchanged
  (confirm → spinner → result). Still hidden behind `enabled`.
- Env: add `GESTEK_API_TOKEN` (+ optional `GESTEK_SYNC_START_DATE`, default e.g. `2024-01-01`).
  `N8N_SYNC_URL/TOKEN` become unused (leave or remove).

## 5. Data flow

Button → `POST /api/sync` (auth + `SYNC_ENABLED`) → `runGestekSync({dryRun})` → Gestek API +
Supabase writes → `SyncResult` → button shows counts. Dashboard reads `clientes_view` (now
computed) + `vendas_view` → reflects fresh data.

## 6. Safety (given the prior incident)

1. **`gestek_id` matching**, locked by a unit test reproducing the exact failure (numeric Supabase
   ids + ObjectId Gestek ids ⇒ **0** false "new").
2. **Insert guard** aborts (no writes) on an implausible number of new patients.
3. **Dry-run mode** computes the plan ("would insert N, upsert M, X dupes") without writing — the
   safe way to re-enable, instead of another blind live sync.
4. **Idempotent** vendas upsert (`onConflict: id`); re-running ⇒ 0 new.
5. `SYNC_ENABLED` gate stays as a kill-switch.

## 7. Testing

- **TDD pure logic:** `match.ts` (incl. the bug case + dup detection), `sales.ts`
  (`mapVendaToRow`, `buildProcedimentos`), `normalizeName`.
- **Orchestrator:** inject a fake Gestek client + fake Supabase; assert guard trips, dry-run
  writes nothing, happy path inserts/upserts the right counts.
- **Live validation:** `?dryRun=1` first (sane counts) → real run → `Clientes` ≈ 337 (+ only
  genuinely new, all with `gestek_id`), revenue correct, 2nd run = 0 new. `npm test` + `npm run
  build` green.

## 8. Out of scope
Vercel Cron schedule, goals editor, incremental sync, removing the now-unused n8n workflows.

## 9. Risks
- **Gestek API shape drift** (pagination/field names) — mitigated by defensive parsing + dry-run.
- **`clientes_view` change** must keep identical output columns (verify the dashboard data layer
  in `src/features/overview` / `src/features/patients` still resolves the same fields).
- **Vercel function time** — full fetch+upsert must stay under `maxDuration=60`; fine at current
  size, revisit if data grows (incremental sync).
