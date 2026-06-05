# Design — Gestek Sync button (Plan 5, scoped)

**Date:** 2026-06-04
**Branch:** `build/foundation`
**Scope:** A "Sync Gestek" button in the Overview header that triggers the existing
N8N worker workflow over HTTP and shows the run summary. Goals editor and Vercel
deploy from the original Plan 5 are **out of scope** (deferred).

## 1. Problem & current state

The Overview gauges read targets from `app_settings`; patient/sales data is kept current
by an N8N worker workflow (`Integrallys - Supabase Vendas Upsert (1).json`). That worker:

- triggers **only** via "When Executed by Another Workflow" (`executeWorkflowTrigger`) —
  it has **no webhook**, so nothing can invoke it over HTTP today;
- runs synchronously (fetch Gestek clientes → diff vs Supabase → insert new patients →
  aggregate monthly sales → bulk-update → upsert vendas) and ends by emitting a `summary`
  object (node "Build Run Summary" → "Set Summary as Output").

`scripts/test-webhook.sh` was written for a `/webhook/gestek-sync` endpoint with an
`X-Sync-Token` header, but that webhook workflow was never actually built.

**Goal:** one click in the CRM → run the sync → show the summary. Requires adding a
webhook entry point to the worker, plus the CRM button + server route.

## 2. Part A — N8N: add a webhook to the worker workflow

Edit the worker workflow JSON to add three nodes. The existing `executeWorkflowTrigger`
**stays** (manual/other callers keep working). New nodes:

1. **Webhook** `Sync Webhook` — `httpMethod: POST`, `path: gestek-sync`,
   `authentication: headerAuth`, `responseMode: responseNode`. Output → `Sync Params`.
2. **Set** `Sync Params` — assigns `trigger = "webhook"`, `mode = "sync"`, then →
   existing `Init Run`. **Required:** a webhook POST has an empty body, and `Init Run`
   defaults to `mode = "backfill"` when `$json.mode` is absent — we must pin `sync`.
3. **Respond to Webhook** `Respond Summary` — fed from the terminal `Set Summary as
   Output`, responds `={{ $('Build Run Summary').first().json }}` → the full
   `{ summary, warnings, completed_at }` body.

Both entry paths converge at `Init Run`; the existing chain is otherwise untouched.

**One-time manual steps the user does in N8N** (cannot be automated from this repo):
import the updated workflow, create a **Header Auth** credential
(Name = `X-Sync-Token`, Value = the token), select it on `Sync Webhook`, and **Activate**
the workflow. Production URL → `https://n8n.oversend.com.br/webhook/gestek-sync`.

### Response contract (what the button parses)

`summary` fields (from "Build Run Summary"): `run_id`, `started_at`, `completed_at`,
`trigger`, `mode`, `patients_updated`, `new_patients_inserted`, `unmatched_sales`,
`duplicate_name_warnings`, `orphan_supabase_patients`, `monthly_windows_processed`,
`total_sales_aggregated`. Plus `warnings[]` (each `{ level, message }`). The parser is
**defensive**: it unwraps `summary` whether the body is `{summary, warnings}` or a bare
summary object, and tolerates missing fields (rendered as "—").

## 3. Part B — CRM: button + server route

Mirrors the existing `chat` feature structure. Three units:

### `src/features/sync/trigger.ts` (`server-only`)
`triggerGestekSync(): Promise<SyncResult>`:
- Reads `N8N_SYNC_WEBHOOK_URL` + `N8N_SYNC_TOKEN`. If either is missing →
  `{ ok: false, code: "not_configured" }`.
- `POST` to the URL with header `X-Sync-Token: <token>`, body `{}`,
  `AbortController` timeout ~55s.
- Non-2xx → `{ ok: false, code: "webhook_error", status, message }`.
- Parses JSON defensively → `{ ok: true, summary, warnings }`. Non-JSON body →
  `{ ok: true, summary: null, raw }` ("sync ran, no summary returned").
- Network/abort → `{ ok: false, code: "network" | "timeout", message }`.
- No React/Next imports → unit-testable with a mocked `fetch`.

### `src/app/api/sync/route.ts`
- `runtime = "nodejs"`, `maxDuration = 60`.
- Auth gate identical to `src/app/api/chat/route.ts`
  (`supabase.auth.getUser()` → 401 if no user).
- `POST` → `triggerGestekSync()` → JSON response. Status: 200 on `ok`, 503 on
  `not_configured`, 502 on `webhook_error`/`network`/`timeout`.

### `src/features/sync/sync-button.tsx` (`"use client"`)
Rendered in the Overview header next to "Hello, Matheus". States:
- **idle** — gold "↻ Sync Gestek" button.
- **confirm** — "Run Gestek sync now? This updates patient data from Gestek." (the sync
  writes to the live DB; one-tap confirm prevents accidental runs).
- **syncing** — spinner + "Syncing…", disabled (route waits the full 10–60s).
- **success** — dismissible inline panel: "✓ Synced — N patients updated, M new,
  K warnings", with `completed_at`; warnings count expands the list.
- **error** — red inline message with the reason (incl. a clear "Sync not configured yet"
  for 503).

## 4. Env

`.env` (gitignored) gets two server-only vars:
```
N8N_SYNC_WEBHOOK_URL=https://n8n.oversend.com.br/webhook/gestek-sync
N8N_SYNC_TOKEN=<the X-Sync-Token value>
```
`N8N_SYNC_WEBHOOK_URL` already exists (line 12). The token was mis-pasted into that line
and must be moved into `N8N_SYNC_TOKEN`. Empty values are valid — the button shows
"not configured" until both are set, so the feature ships before the webhook is live.

## 5. Testing & verification

- **TDD unit tests** (Vitest, mocked `fetch`) for `trigger.ts`: not-configured → correct
  shape; happy path → normalized summary; wrapped vs bare `summary` envelope; N8N 500 →
  `webhook_error`; non-JSON body → graceful; asserts the `X-Sync-Token` header is sent.
- **Mock live verification** (Playwright): a throwaway local endpoint returns a sample
  summary; point `N8N_SYNC_WEBHOOK_URL` at it; log in, click the button, confirm, assert
  the result panel renders the right numbers and 0 console errors.
- `npm run build` clean; `npm test` green.

## 6. Out of scope (deferred)

- Goals editor (editable `app_settings` targets).
- Vercel deploy.
- Pointing at the real production webhook — the user drops the live URL/token into `.env`
  and activates the N8N workflow; no code change needed.
