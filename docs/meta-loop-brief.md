# Brief: reliable two-way data between Meta Ads and the CRM

## The goal, in the owner's words

> "My ultimate goal is to always receive the data from Meta reliably — right now sometimes the
> integration with Sheets stops working, which never triggers the n8n bot, which never sends
> the data to the CRM — and be able to send it back in the same manner."

Two directions, one requirement: **it must not fail silently.**

- **IN:** a Meta Instant Form lead must reach the CRM, always, and we must know within hours
  if one didn't.
- **OUT:** the CRM's funnel outcomes must reach Meta so the campaign optimizes for patients
  who book and pay, not for cheap form fills.

## Decisions already made — do not relitigate

- **Build the new intake properly, as a Meta App integration.** The current
  Gmail → n8n → CRM chain is the thing being replaced.
- **Keep the existing CAPI outbox** (`src/features/capi/`). It is good infrastructure —
  transactional recording, dedup, retry, 7-day expiry, delivery off the request path via
  `after()`. What is wrong with it is the *data* it ships, not the plumbing.
- **Autonomy model: the system recommends, the owner approves.** Nothing reaches Meta — no
  audience push, no bulk event backfill — without a human clicking yes. This is a hard
  requirement, not a phase-one caution.
- **Scope: better conversion signal + audience engine.** Not automated budget/bid management.

## Build order

### Step 0 — reliable inbound (do this first)

Nothing else matters if leads don't arrive. Three parts, because a webhook alone is not
reliability:

1. **The `leadgen` webhook.** A Meta App subscribed to the `leadgen` topic POSTs to a new CRM
   endpoint. No Gmail, no Sheets, no n8n. The webhook payload carries `leadgen_id` /
   `form_id` / `page_id`, **not** the field data — you then fetch the lead with a page access
   token. Verify the exact contract with `devtools_discovery` rather than from memory.
2. **A reconciliation sweep.** Poll Meta for all leads on the form and backfill anything the
   webhook missed. This is what turns "usually works" into "cannot lose a lead". Without it,
   an endpoint outage lasting longer than Meta's retry window loses leads permanently.
3. **A dead-man alarm.** If no lead has arrived in N hours, tell someone. **This is the piece
   that is missing today** — the current pipeline fails silently and looks identical to a
   quiet week. Cheapest of the three, highest value.

**THE BLOCKER — confirmed 2026-08-12, this is paperwork, not engineering.**

The `leadgen` webhook needs the `leads_retrieval` permission, which requires App Review.
Checked via `devtools_app_review` on all four apps the owner administers:

| App | ID | Approved privileges |
| --- | --- | --- |
| **Integrallys** | `3152141494985625` | **none** |
| Ana_Atendente | `2746352369040120` | none |
| TestePersonal | `2416700272152136` | not checked |
| n8nPsintegrada | `1174688364743329` | none |

`privileges: []` **and** `rejections: []` everywhere — nothing was ever submitted, let alone
refused. And `devtools_webhook_list` on the Integrallys app returns **zero subscriptions**.
This is why the earlier Ottokit attempt "could not be made to deliver": the app never had
permission to retrieve lead data.

`devtools_app_review requirements` on the Integrallys app:

```
can_submit: true
has_privacy_policy: false            ← blocker, owner must fix
business_verification_passes: false  ← blocker, owner must fix
requested_privileges: null
```

**Two prerequisites the owner must complete before App Review can even be submitted:**

1. **A privacy policy URL** on the app. The repo already ships `integrallys-landing/`, so
   hosting one there is the path of least resistance.
2. **Business Verification** in Business Manager — legal documents, CNPJ. This takes days to
   weeks and is entirely outside our control, so it should be started immediately and run in
   parallel with everything else in this brief.

Do not write the webhook endpoint expecting to test it end-to-end until `leads_retrieval` is
approved. Steps 1 and 2 below are unblocked and worth doing while the review is pending.

Once approved: `devtools_webhook_list` for subscriptions, `devtools_webhook_manage` to
subscribe, `devtools_webhook_test` to verify delivery.

### Step 1 — identity resolution (the foundation for everything after)

**The core finding of the investigation:** the CRM knows exactly who paid and how much, and
has no idea any payer was ever a lead.

- `public.form_leads` (migration 021) has `name`, `phone` (digits only, country code
  included), `email`, `external_id` (Meta lead id), `stage`. **No `cliente_supabase_id`, no
  link to sales whatsoever.**
- `public.gestek_vendas` has `cliente_supabase_id`, `valor_pago` (what they actually paid),
  `data`, `procedimentos`. Exposed as `public.vendas_view` filtered to `status = 1`.
- `"Clientes"` carries `"Telefone Principal"` and `"Email Principal"`.

So phone and email sit on both sides, unjoined. Consequences today:

- `stage = 'ganho'` is **a human clicking a button**, not a fact derived from a real sale.
- `Purchase` events carry `META_CAPI_PURCHASE_VALUE` — **one flat number for every patient**,
  whether they spent R$300 or R$8.000.

Build a `lead_conversions` table joining `form_leads` → `Clientes` → `vendas_view`, storing
match method, confidence, first sale date, total paid, procedures. Phone is the primary match
key, email second, name similarity last and **never auto-accepted**. Exact matches link
automatically; fuzzy ones queue for human confirmation on `/marketing`. Everything downstream
reads this table and never re-derives the join.

### Step 2 — conversion signal v2

Riding the existing outbox, with the join in place:

- `Purchase` carries the real `valor_pago` in BRL. Teaching Meta that some leads are worth 25×
  others will move bidding more than anything else in this document.
- `ganho` becomes derived from an actual sale rather than a judgement call.
- Create the **Custom Conversion** in Events Manager. `LeadContatado` / `LeadRespondeu` /
  `LeadQualificado` / `LeadPerdido` are custom events — reportable but **not optimizable**
  until wrapped in one. `Lead`, `Schedule`, `Purchase` are standard and need no such step.

### Step 3 — audience engine (blocked on a compliance answer)

Segments from the same join: buyers, high-value buyers (top quartile `valor_pago`),
booked-not-bought, qualified-not-booked. Push as hashed Custom Audiences; build Lookalikes
from high-value buyers; suppress existing customers from acquisition campaigns.

**Do not build this until the compliance question is answered.** Uploading patient contact
lists segmented by aesthetic procedure is health-adjacent data under both LGPD and Meta's
rules on sensitive categories. Audiences defined as "bought procedure X" may not be
permissible. "All buyers" and "high-value buyers" are much safer ground.

## Verified state of Meta's side, 2026-08-12 (read-only, via the Facebook Ads MCP)

Re-verify before trusting — these are a snapshot, and the whole point is to change them.

**Working:**
- Dataset `678560753509373` ("Pedro Bellumat Oliveira's Pixel", business `167208670641222`)
  active, `last_fired_time` 2026-08-11, real-time uploads.
- **37 `Lead` events in 7 days**, all `SERVER` source. Meta recognises the `crm` channel, so
  `event_source: "crm"` + `lead_event_source` land correctly.
- Event Match Quality **6.6/10**; email, phone, external_id, fn, ln all at **100%** coverage.
  fbc / fbp / ip_address / user_agent at 0%, expected for server-side CRM events.

**Broken:**
- `Lead` is the **only** event arriving. Zero `LeadContatado`, `LeadRespondeu`,
  `LeadQualificado`, `Schedule`, `Purchase`, `LeadPerdido`. `Lead` fires automatically on
  ingest; every event that says a lead was *good* is missing.
- Diagnose via `public.capi_events` grouped by `event_name` and `status`. Three candidate
  causes: rows `pending` (delivery broken), rows `sent` but absent at Meta (consumed by a test
  send — see gotchas), or no rows at all beyond `novo` (nobody moves leads on `/marketing` —
  a process problem; say so plainly rather than inventing a code fix). Also check `expired`.

**Ad accounts — a live problem:**
- `639971513852564` ("Anúncios Integrallys") and `1294321399438748` ("Integrallys") are both
  `DISABLED`: *"flagged because of unusual activity. All your ads have been paused."*
- `490285567688905` ("Integrallys", same business as the dataset) is the only `ACTIVE` one,
  but has `is_ads_mcp_enabled: false` — MCP tools cannot query it. Use Events Manager by hand,
  and the Marketing API with an own token for audience pushes.

## Environment and tooling

- Repo root `/Users/matheusbredapolezi/Developer/Integrallys` (one git repo, several projects).
  The CRM is `Supabase Vendas Upsert/`, package `integrallys-crm`, Next.js on Vercel.
- **Read `Supabase Vendas Upsert/AGENTS.md`.** This Next.js version has breaking changes vs.
  your training data; read `node_modules/next/dist/docs/` before writing Next-specific code.
- **Read `docs/meta-capi.md`** — the design doc for the existing outbound integration, and it
  explains *why* each event exists. Do not duplicate it into new docs.
- MCP servers, both connected: `meta_developer_tools` (the `devtools_*` tools) and
  `claude.ai Facebook Ads` (the `ads_*` tools). **`meta_developer_tools` needs re-authenticating
  every time Claude Code restarts** — that is normal for this server. Re-auth with `/mcp`.
- `META_CAPI_*` env vars are set in Vercel production (`META_CAPI_ENABLED=true`). Names live in
  `.env.local.example`. Never read `.env`; never print token values.

## Hard-won constraints — do not relearn these the expensive way

- **Vercel is on the Hobby plan: one cron per day**, 09:00 UTC. A daily reconciliation sweep
  worst-cases at 24h behind. Vercel Pro ($20/mo) buys 15-minute crons; for a lead pipeline
  that is the cheapest reliability available, and the owner has been told so.
- **A test send marks rows `sent`.** Reset them to `pending` afterwards or those real
  conversions never reach production — and the unique index on `(form_lead_id, event_name)`
  means they can never be recreated for that lead. Permanent signal loss.
- **Turning off `META_CAPI_ENABLED` is not neutral.** Recording continues, sending stops, and
  unsent rows expire after Meta's 7-day window. A dark period destroys signal.
- **Test Events has separate channels.** The `test_event_code` under **Site** is what server
  events use. The **CRM** channel is a different guided flow entirely.
- **Optimize on `Schedule` / `Purchase`, never on `LeadRespondeu`.** "Replied" counts
  rejections too — of the first two repliers, one was in-market and one had already solved her
  problem.
- **`LeadContatado` is inert by design.** It records *our* action, so nearly every lead
  reaches it. Send it, never optimize for it.
- **`perdido` is a verdict, not a milestone.** Mark it only when genuinely giving up on a
  person. Silence is not lost. A premature `perdido` cannot be retracted.
- **Campaign id ≠ dataset id.** `52592595649455` is the *campaign*, not a valid dataset.
- **The CAPI token can POST events but cannot read dataset metadata** (`#100 Missing
  Permission`). Expected, not a misconfiguration.
- **Supabase does not auto-migrate** the way the old sqlite store did. Confirm a column exists
  before assuming a new field is deploy-safe.

## How the owner wants you to work

Diagnose, show the evidence, propose the fix, wait for a go-ahead before editing code. Tests
live alongside features (`*.test.ts`, vitest) — keep them passing. **Explain results in plain,
non-technical language**: what happened, and what he has to do next. There is a `summary`
skill in the project for exactly this — use it when he asks what you did.
