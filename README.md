# Gestek → Supabase Sales Aggregation

Pipeline that syncs patient sales data from the **Gestek CRM** into a **Supabase** dashboard table. Runs entirely in N8N (no server code to deploy).

## What it does

For every patient in `public."Clientes"`, fills in five aggregate columns:

- `Procedimentos` — comma-separated list of items with counts (e.g. `"Botox (3), Limpeza (2)"`)
- `Numero de Vendas` — number of completed sales
- `Receita Total` — total revenue
- `Descontos` — total discounts given
- `Ticket Medio` — average ticket = revenue / sales

All columns are stored as TEXT (matching the existing schema). The dashboard formats them for display.

Aggregation is **complete and idempotent on every run** — it re-fetches all historical sales from Gestek and rebuilds these columns. No drift, no double-counting, picks up edits to old sales.

## How it runs

| Trigger | Workflow | When |
|---|---|---|
| Manual click in N8N | `Gestek - Backfill` | Once, after initial setup |
| Webhook POST | `Gestek - Sync` | Whenever the dashboard "Sync" button is pressed |
| Cron `0 3 1 * *` | `Gestek - Sync` | 1st day of every month, 03:00 |

## Schema requirements

Your existing table must be `public."Clientes"` with at least:
- `id` (text, primary key) — **must equal the Gestek client ID** (`clientes[].id` from `/api/clientes`)
- `Nome` (text)
- `Data do Cadastro` (text, format `DD/MM/YY HH:MM` — Brazilian local time)
- The 5 writeable columns above (all text)

Sync will INSERT new patients with `id`, `Nome`, `Data do Cadastro`. `Telefone Principal`, `Email Principal`, and `Origem` are left NULL.

## Repo layout

```
sql/
  001_gestek_sync_logs.sql              ← run-history log table
  002_bulk_update_patient_metrics.sql   ← Postgres RPC for batch update

n8n/code-nodes/
  00_init_run.js                        ← generate run_id, started_at
  01_build_clientes_map.js              ← parse /api/clientes responses
  02_split_patients.js                  ← categorize existing vs new (by id)
  03_generate_monthly_windows.js        ← parse DD/MM/YY dates, produce windows
  04_aggregate_sales.js                 ← sum sales per clienteId
  05_build_update_payload.js            ← format RPC payload (text strings)
  06_build_run_summary.js               ← final summary for webhook response

scripts/
  test-webhook.sh                       ← curl helper for testing sync

SETUP.md                                ← node-by-node N8N build guide
README.md                               ← this file
```

## Setup

See [SETUP.md](SETUP.md) — it walks through Supabase migrations, N8N credentials, and building both workflows step by step.

## Architecture

```
Gestek API                       N8N                        Supabase
──────────                       ───                        ────────

GET /api/clientes  ◄────────── Fetch (paginated)
                                   │
GET /api/vendas    ◄────────── Fetch monthly windows
   (Status=1)                      │
                                   ▼
                               Aggregate per clienteId
                                   │
                                   ▼
                               RPC bulk_update_patient_metrics ──► Clientes table
                                                                   gestek_sync_logs
```

## Decisions worth knowing

| Decision | Why |
|---|---|
| Patients matched by Gestek `clienteId` (no name matching) | `Clientes.id` IS the Gestek ID — direct equality match. |
| Backfill window starts at `min("Data do Cadastro")` across patients | One monthly loop covers everyone; cheaper than per-patient fetches. |
| Only `status = 1` (Venda) counted | Quotes and cancelled sales aren't revenue. |
| Full re-aggregation every run | Idempotent; catches edits to old sales; ~1-2 min for 5 years of history. |
| Postgres RPC for bulk UPDATE | One HTTP request to Supabase per sync vs hundreds. |
| `Procedimentos` includes all `itens` regardless of `tipo` | User preference (products, procedures, packages all counted). |
| Metric columns written as plain-ASCII strings (`"2500.00"`) | Existing columns are TEXT; dashboard formats for display. |

## Limits / out of scope

- Dashboard UI is not part of this repo (only the outbound sync trigger).
- Real-time sync isn't possible — Gestek's public API has no webhooks.
- Patients deleted from Gestek aren't removed from `Clientes` (they show up as `orphan_supabase_patients` in the run summary; clean up manually if desired).
- BRL only; no multi-currency.
