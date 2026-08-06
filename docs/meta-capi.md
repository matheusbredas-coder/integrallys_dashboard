# Meta Conversions API (CAPI)

Reports every form-lead funnel stage back to Meta, so the Leads campaign can optimize for
leads that qualify, book and buy — not for raw form volume.

Built to Meta's CRM integration guide. Dataset `678560753509373`, Graph API `v26.0`.

## Why

Meta delivers the Instant Form lead and then goes blind. Everything after that happens in the
CRM: someone works the lead and moves it through `novo → contatado → qualificado → agendado →
ganho | perdido`. Meta never learns which leads were any good, so it optimizes for the cheapest
form fill it can find.

This sends the funnel back.

## What gets sent

**Every stage of the funnel**, including the first one. Meta's CRM integration guide is
explicit: *"É preciso ter um gatilho para cada estágio do seu funil, incluindo o estágio
inicial do lead."*

| Stage | Fired from | Event sent to Meta | Type |
| --- | --- | --- | --- |
| `novo` | `/api/leads/form` (ingest) | `Lead` | standard |
| `contatado` | `/marketing` | `LeadContatado` | custom |
| `respondeu` | `/marketing` | `LeadRespondeu` | custom |
| `qualificado` | `/marketing` | `LeadQualificado` | custom |
| `agendado` | `/marketing` | `Schedule` | standard |
| `ganho` | `/marketing` | `Purchase` (+ `value`/`currency` if `META_CAPI_PURCHASE_VALUE` is set) | standard |
| `perdido` | `/marketing` | `LeadPerdido` | custom |

The whole funnel is sent on purpose. The model is learning the funnel's *shape*, not just its
wins: without `novo` it has no denominator to read the qualified count against, and without
`perdido` it never learns what a bad lead looks like.

**`contatado` vs `respondeu`** is the distinction that carries the most information, and it is
easy to collapse by accident. `contatado` means *we* sent a WhatsApp message — every lead we
work reaches it, so on its own it discriminates nothing. `respondeu` means the *lead* wrote
back. In the first batch of 9 leads, 9 were contacted and 1 replied; only that 1 is a signal.
When in doubt about which to use, ask whose action the stage records.

> ⚠️ **The `Lead*` names are custom events.** They are reportable as they are, but *not*
> optimizable until you create a **Custom Conversion** in Events Manager pointing at one
> (setup step 4). `Lead`, `Schedule` and `Purchase` are standard events and need no such step.

Every event also carries the two fields Meta's CRM integration requires in `custom_data`:
`event_source: "crm"` and `lead_event_source` (the CRM's name, `META_CAPI_LEAD_EVENT_SOURCE`).
Without them the events arrive but aren't recognized as a CRM funnel.

## Setup

### 1. Dataset ID — already set

`678560753509373`, from Meta's CRM integration guide. Already in `.env.local.example` and the
local `.env` as `META_CAPI_DATASET_ID`; it still has to be set in **Vercel**.

The endpoint it produces is the one the guide specifies:

```
https://graph.facebook.com/v26.0/678560753509373/events
```

### 2. Generate an access token

Events Manager → **Settings** → **Conversions API** → **Generate access token**. Set it as
`META_CAPI_ACCESS_TOKEN`.

This token is a credential with write access to your event data — it lives in Vercel env vars
only, never in the repo.

### 3. Test before going live

Set `META_CAPI_TEST_EVENT_CODE` to the code from Events Manager → **Test Events**, and set
`META_CAPI_ENABLED=true`. Move a lead to `qualificado` on `/marketing`; the event should appear
in the Test Events tab within seconds, along with which parameters Meta managed to read.

A test event only proves the connection works — it does not validate that the data is right.
Check the Event Match Quality and **Diagnostics** tabs a day after real events start flowing.

**Clear `META_CAPI_TEST_EVENT_CODE` before production.** While it's set, events go to the test
tab *instead of* production, and real conversions stop counting.

### 4. Make a custom event optimizable (optional)

`LeadContatado`, `LeadQualificado` and `LeadPerdido` are custom events — reportable, but not
selectable as a campaign objective until you wrap one in a Custom Conversion.

Events Manager → **Custom Conversions** → **Create**, source = your dataset, rule = event
equals `LeadQualificado`. `Lead`, `Schedule` and `Purchase` are standard and need no such step.

### 5. Turn it on

Set `META_CAPI_ENABLED=true` in Vercel.

While it is off, stage changes are still **recorded** in `capi_events` as `pending`. The cron
delivers them the moment you switch it on, so nothing that happened in between is lost.

Meta expects the integration to upload at least once a day, which the 15-minute cron covers
comfortably — but it also means a long stretch of `pending` rows is a real alarm, not noise.

## How it works

```
POST /api/leads/form   → enqueueStageEvent(id, "novo")      the opening Lead event
updateFormLeadStage()  → enqueueStageEvent(id, <new stage>) every later stage
     features/form-leads/actions.ts

  enqueueStageEvent()            features/capi/queue.ts
       ├─ buildEvent()           features/capi/event.ts   (pure)
       │    └─ buildUserData()   features/capi/hash.ts    (pure, SHA-256)
       ├─ INSERT capi_events     status = 'pending'   ← awaited
       └─ after(() => send)      ← runs AFTER the response is sent
             └─ sendCapiEvent()  features/capi/client.ts  → graph.facebook.com

/api/cron/capi  (every 15 min) → drainPendingCapiEvents() → retries whatever is still 'pending'
```

Two deliberate properties:

- **Recorded before sent.** A stage change is a human action nobody repeats — if an inline
  send failed and that were the end of it, the signal would be gone for good. The INSERT is
  awaited, so the row is committed before the action returns. A Meta outage becomes a delay,
  not a loss.
- **Sent after the response.** The Graph API call is handed to `after()` (`next/server`) so a
  slow Meta endpoint — up to the 8s timeout — never sits between the user's click and the UI
  updating. A bare floating promise would just be killed when the serverless function returns;
  `after` is what keeps it alive.

### Matching (EMQ)

Meta matches on hashed identifiers. Our normalization has to land on byte-identical strings to
theirs or a value doesn't match *at all* — there is no partial credit.

| Field | Normalization before SHA-256 |
| --- | --- |
| `em` | trim + lowercase |
| `ph` | digits only, country code included, no `+`, no leading zeros |
| `fn` / `ln` | lowercase, accents folded, punctuation and spaces removed |
| `external_id` | our `form_leads.id` |
| `lead_id` | **never hashed** — it is Meta's own id, sent as a plain number |

Hashed fields are sent as **arrays** (`"em": ["<hash>"]`), matching the payload in Meta's
guide.

`lead_id` is by far the strongest signal available: when the "Lead Nova" email carried Meta's
lead id, `form_leads.external_id` holds it and attribution is exact rather than probabilistic.
When it didn't, `external_id` is a `gmail:<message_id>` fallback and the hashed contact fields
carry the match instead.

Empty values are **omitted**, never sent as the hash of `""` — a blank parameter counts against
the Event Match Quality score, so an absent field beats a hollow one.

`action_source` is `system_generated`: there is no browser in this flow, so we hold no `fbp`,
`fbc`, IP or user-agent. EMQ for these events is therefore lower than for a website pixel
event, and that is expected.

### Deduplication

`event_id` is `<form_lead_id>:<event_name>` — deterministic, not a random UUID. A fresh id per
attempt would make every retry look like a separate conversion to Meta and inflate the exact
numbers this feature exists to make trustworthy.

Two layers:

- **Database** — unique index on `(form_lead_id, event_name)`. Dragging a lead
  `qualificado → contatado → qualificado` inserts nothing the second time.
- **Meta** — the stable `event_id` means a replay is recognized and discarded on their side.

There is no Pixel ↔ CAPI deduplication happening here, because no browser-side Pixel event
corresponds to these — they fire inside the CRM, hours or days after the lead left the ad.

## Operating it

Everything is in `public.capi_events`:

```sql
-- anything stuck
select status, count(*), max(updated_at) from public.capi_events group by 1;

-- why the last failures failed
select event_name, error_code, error_message, fbtrace_id, attempts, updated_at
from public.capi_events where status = 'failed'
order by updated_at desc limit 20;
```

| `status` | Meaning |
| --- | --- |
| `pending` | not delivered yet; the cron will try again |
| `sent` | Meta accepted it |
| `failed` | permanent error — retrying will not help, needs a human |
| `expired` | older than Meta's 7-day window; can never be delivered |

Error classification lives in `features/capi/client.ts`. Codes `2`, `100`, `102` and `190` are
permanent; everything else — including every network failure, timeout and 5xx — is retried.

- **`error_code` 190** → the access token expired or was revoked. Regenerate it (setup step 2).
  Every event stalls until you do; this one logs loudly.
- **`error_code` 4 / 17 / 32 / 613** → rate limited. Nothing to do; the next run picks it up.
- **`fbtrace_id`** is the handle Meta support will act on. Always quote it.

`payload` holds the request body **already hashed**. This table is deliberately not a second
copy of a lead's personal data — the only readable values in it are the lead's row id and the
event name.

Match quality shows up in Events Manager → your dataset → **Event Match Quality**, roughly
24–48h after the first production events.
