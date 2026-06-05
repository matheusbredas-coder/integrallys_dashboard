# Handoff — integrallys-crm

Premium dark/gold clinic CRM (Next.js 16 + Supabase + Anthropic). Branch: **`build/foundation`**.
Secrets live in **`.env`** (NOT `.env.local`) — load with `--env-file=.env`. Never print secret values.

**🚀 LIVE on Vercel:** https://integrallys-crm.vercel.app (project `pedro-bellumat-s-projects/integrallys-crm`, deployed via Vercel CLI; 4 env vars set in Production: Supabase URL/anon/service + Anthropic). Deploy: `vercel --prod`. Prod verified 2026-06-04 (login → dashboard real data, patients, **sync button disabled**, 0 console errors).

**⛔ Gestek Sync is GATED OFF (`SYNC_ENABLED` unset = disabled).** The N8N worker behind the webhook **mass-duplicates patients** — a live test inserted 100 dup rows (since reverted; DB restored to 337). Do NOT set `SYNC_ENABLED=true` until the N8N worker is fixed + safely validated. See [memory: gestek-sync-massdup-incident] and the section below.

## What's done
- **Plan 1** (auth + app shell + data layer), **Plan 2** (Overview page), **Plan 3** (Patients table + detail drawer) — all implemented, committed, and **live-verified** via Playwright with real data (login → gold dashboard, real numbers, 0 console errors).
- **Plan 4** (text-to-SQL AI chat) — **DONE & live-verified** on `build/foundation`. 30 Vitest tests pass; `npm run build` succeeds; `/api/chat` is a dynamic route. Two-layer SQL safety: TS guard ([src/lib/sql-guard.ts](src/lib/sql-guard.ts)) + txn-level read-only inside RPC `run_readonly_select`.
- **SQL applied in Supabase:** `005` (crm_readonly role), `008` (RPC), and **`009`** (committed `24fb288`) which drops the forbidden `SET ROLE` from the RPC and uses `set local transaction_read_only = on` instead. `008`'s `SET ROLE` failed at runtime — **009 is the live version**.
- **Plan 4 live verification (2026-06-04):** `check_rpc.mjs` → read=838, write blocked. Playwright chat run (`/tmp/verify_chat.py`): Botox → **84 pacientes**, faturamento → **R$424.038,95**, 0 console errors. Screenshots `08-chat-botox.png` + `09-chat-revenue.png`.
- **Plan 5 — Gestek Sync button** (scoped: button only; goals editor + Vercel deploy deferred) — **DONE & verified (mock)**. Overview-header button → confirm → `/api/sync` (auth-gated, `maxDuration=60`) → `triggerGestekSync()` POSTs the N8N webhook with `X-Sync-Token` → shows the run summary. 40 Vitest tests pass; `npm run build` clean (`/api/sync` dynamic). Playwright mock run (`/tmp/verify_sync.py`): "✓ Synced — 271 updated, 2 new, 1 warnings", 0 console errors, screenshot `10-sync-result.png`. Spec `docs/superpowers/specs/2026-06-04-gestek-sync-button-design.md`, plan `docs/superpowers/plans/2026-06-04-gestek-sync-button.md`.
  - **N8N webhook added to the worker workflow** (`Integrallys - Supabase Vendas Upsert (1).json`): `Sync Webhook` (POST `/webhook/gestek-sync`, Header Auth `X-Sync-Token`) → `Sync Params` (trigger=webhook, mode=sync) → existing `Init Run`; `Set Summary as Output` → `Respond Summary`. The old `executeWorkflowTrigger` path is untouched.
  - **⚠️ User one-time steps to go live (in N8N):** import the updated workflow JSON → create a **Header Auth** credential (Name `X-Sync-Token`, Value = the token) → select it on the `Sync Webhook` node → **Activate** the workflow. Then confirm `.env` has `N8N_SYNC_WEBHOOK_URL=https://n8n.oversend.com.br/webhook/gestek-sync` + `N8N_SYNC_TOKEN=<token>` (already set this session; token was moved out of the URL slot where it had been mis-pasted). Until then the button shows "Sync not configured yet" / a webhook error.
- Data model live: `clientes_view` (337 patients), `vendas_view`/`vendas_monthly` (838 sales, source of truth), `procedimentos_expanded`, `app_settings`. Revenue billed Σ`total` = **R$424.038,95**, collected ≈ R$408k.

## Plan 4 verification checklist — COMPLETE ✅
- [x] SQL guard + agent logic (TDD, 30 tests pass)
- [x] `/api/chat` route + chat UI (slide-over launcher), `npm run build` OK
- [x] Applied `005_readonly_role.sql` + `008_run_readonly_select.sql` + `009_fix_run_readonly_select.sql`
- [x] RPC live (`check_rpc.mjs` → read=838, write blocked at DB layer)
- [x] Playwright chat run: Botox=84, faturamento R$424.038,95, 0 console errors
- [x] Plan 4 complete

## Environment
- **Next.js 16.2.7 / React 19.2.4 / Tailwind v4 / Vitest 4** (see [package.json](package.json))
- Package manager: **npm**. Project path: `/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert`
- Env vars in `.env` (gitignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` (all set). `SUPABASE_READONLY_CONNECTION_STRING` + `N8N_SYNC_WEBHOOK_URL` empty (not yet needed).
- Login test user: **matheus@oversend.com.br / integrallys**
- App/db checks need network (Google Fonts + Supabase) → run Bash with **`dangerouslyDisableSandbox: true`**.

## Running commands
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"

# unit tests + build (both confirmed passing this session)
npm test
npm run build

# confirm the chat's read-only RPC is live (run after user applied 005+008)
node --env-file=.env .superpowers/verify/check_rpc.mjs

# live web test (Playwright): server is managed by the helper
python3 "/Users/matheusbredapolezi/.claude/skills/webapp-testing/scripts/with_server.py" \
  --server "npm run dev" --port 3000 --timeout 90 -- python3 /tmp/verify_chat.py
```

## Next step to pick up from
**Plans 1–4 are all done & live-verified.** Next up: **Plan 5 — Settings page** (editable goals + Gestek N8N sync button + Vercel deploy). Plan file: [docs/superpowers/plans/](docs/superpowers/plans/) (note: 3 new plan files were drafted this session — `integrallys-crm-chat.md`, `integrallys-crm-overview.md`, `integrallys-crm-patients.md`; confirm which plan drives Plan 5). Do the cleanups below during Plan 5. `N8N_SYNC_WEBHOOK_URL` + `SUPABASE_READONLY_CONNECTION_STRING` in `.env` are still empty and will be needed for the Gestek sync.

## Key files
- [src/features/chat/agent.ts](src/features/chat/agent.ts) — `runChat()` streaming tool-use loop (`claude-opus-4-8`, adaptive thinking, prompt-cached schema)
- [src/features/chat/schema.ts](src/features/chat/schema.ts) — SCHEMA_DESCRIPTION of the 4 views given to Claude
- [src/app/api/chat/route.ts](src/app/api/chat/route.ts) — auth-gated streaming POST
- [src/lib/sql-guard.ts](src/lib/sql-guard.ts) — `validateReadonlySql()` (layer 1)
- [db/migrations/008_run_readonly_select.sql](db/migrations/008_run_readonly_select.sql) — RPC executor (layer 2)
- [.superpowers/verify/check_rpc.mjs](.superpowers/verify/check_rpc.mjs) — RPC liveness probe (gitignored)

## Dead code / cleanups (do during Plan 5)
- Rename `src/middleware.ts` → `src/proxy.ts` (Next 16 deprecation warning)
- Delete unused `src/features/overview/ask-bar.tsx` (superseded by chat launcher)
