# Ottokit — Meta Instant Form leads → CRM

An Ottokit workflow subscribes to Meta's **Facebook Lead Ads → New Lead** trigger and
POSTs every lead to this app's `/api/leads/form`, which stores it in `public.form_leads`
and shows it under **Leads do formulário (Meta)** on `/marketing`.

This replaced a Google Sheet polled once a minute by a bound Apps Script (retired 2026-08-04).
Ottokit delivers in seconds and removes the Sheet from the loop entirely.

## The workflow

```
Facebook Lead Ads — New Lead
  └─→ Slack   — Send Message to Channel
  └─→ Gmail   — Send Email
  └─→ Webhooks — Custom Request      ← the step that reaches this app
```

Slack and Gmail are Ottokit's own steps. Because Ottokit already notifies, leave
`SLACK_WEBHOOK_URL` **unset** in Vercel — setting it makes the CRM post the same lead to
Slack a second time. Leads still land on `/marketing` regardless.

> **Not "Respond to Webhook".** The Webhooks app offers *Respond to Webhook*, *Custom
> Request*, and *Custom API Request*. Only **Custom Request** sends an outbound HTTP
> request. *Respond to Webhook* replies to an inbound **Catch Webhook** trigger — this
> workflow starts from Facebook Lead Ads, so that action has nothing to reply to and
> silently sends nothing.

## Setting up the step

Use the **Custom API Request (Beta)** action, not *Custom Request*: only the Beta one
exposes a Method selector and a raw body editor. (*Respond to Webhook* is unrelated — it
replies to a Catch Webhook trigger, which this workflow doesn't have.)

| Setting | Value |
|---|---|
| Select Method | `POST` |
| Endpoint URL | `https://integrallys-crm.vercel.app/api/leads/form` |
| Select Payload Type | **Raw JSON** — the `JSON` option is a flat key/value builder and mangles `field_data` |

Body:

```json
{
  "secret":        "<FORM_LEADS_SECRET>",
  "id":            "{{id}}",
  "created_time":  "{{created_time}}",
  "campaign_name": "{{campaign_name}}",
  "adset_name":    "{{adset_name}}",
  "ad_name":       "{{ad_name}}",
  "form_id":       "{{form_id}}",
  "form_name":     "Avaliação gratuita",
  "field_data":    "{{field_data}}"
}
```

### Why the secret is in the body and not a header

The route prefers `Authorization: Bearer <FORM_LEADS_SECRET>` and any other caller should
use it. Ottokit can't: its header Value widget appends a newline to whatever you type, and
its own HTTP client then rejects the request with *"... is not valid header value"* before
anything is sent. Setting the value to `Bearer abc` reproduces it as `"Bearer abc "`.

So the route also accepts a `secret` key in the JSON body. A query string was the other
option and is worse — it would write the secret into Vercel's access logs and every proxy
in between, whereas request bodies aren't logged. `secret` is stripped from the payload
before anything is persisted (`RESERVED_BODY_KEYS` in `mapping.ts`), so it never reaches
`form_leads.raw`. There's a test pinning that.

Headers are otherwise unnecessary — Raw JSON sets `Content-Type` itself.

`FORM_LEADS_SECRET` lives in the Vercel dashboard (project → Settings → Environment
Variables). Read the existing value rather than generating a new one; rotating it means
changing it in both places at once.

### Why the body looks like that

- **`field_data` is passed through whole.** The route flattens Meta's
  `[{ name, values }]` array itself (`flattenFieldData` in
  `src/features/form-leads/mapping.ts`), so there is no per-question mapping to maintain
  in Ottokit. Add a question to the Meta form and it flows through to `raw` with no
  config change here. It also survives Ottokit handing the array over as a JSON string.

- **`form_name` is typed literally.** Ottokit's trigger exposes `form_id` but not the
  form's name, and the mapper deliberately refuses to read an `*_id` field as a name
  (there are tests pinning that). Typing the real name keeps the **Formulário** column
  readable instead of showing an opaque numeric id. With several forms, use one workflow
  per form. Omit the line and the column shows `—`; nothing breaks.

- **`ad_name` / `adset_name` / `form_id`** aren't mapped to columns but are kept verbatim
  in `form_leads.raw`, so campaign-level attribution is recoverable later.

## Responses

| Response | Meaning |
|---|---|
| `{ "ok": true, "id": "…", "duplicate": false }` | Lead stored, `/marketing` refreshed |
| `{ "ok": true, "duplicate": true }` | Meta lead id already ingested — no second row, no notification |
| `401` | Neither the `Authorization` header nor the body's `secret` matched `FORM_LEADS_SECRET` |
| `400 Nenhum campo recebido` | Body had no usable fields — check the token mapping in Ottokit |
| `502` | The DB write failed. Check Vercel function logs; the lead was **not** stored |

Deduplication is server-side on Meta's lead id (`form_leads.external_id`, unique index in
migration 021), so re-sending a lead — an Ottokit retry, a manual re-run, a second
workflow — can never create a duplicate row or a duplicate notification.

## Testing

Against a local dev server (`npm run dev`):

```bash
curl -sS -X POST http://localhost:3000/api/leads/form \
  -H "Authorization: Bearer $FORM_LEADS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id":"l_test_1","created_time":"2026-08-04T13:00:00+0000",
       "campaign_name":"Teste","form_name":"Avaliação gratuita",
       "field_data":[{"name":"full_name","values":["Teste Ottokit"]},
                     {"name":"phone_number","values":["+55 41 99999-8888"]},
                     {"name":"email","values":["teste@example.com"]}]}'
```

First call returns `duplicate: false`, a second returns `duplicate: true`. The lead should
appear on `/marketing` with the phone normalized to `5541999998888` and a working
`wa.me` link. Delete the test row from Supabase afterwards.

In production, use the **Test** button on the Custom Request step, or submit through the
Meta form's own preview.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Ottokit reports success, no lead in the CRM | The step is *Respond to Webhook*, which sends nothing |
| `405` | The step is *Custom Request*, which has no Method selector and fires a GET — switch to *Custom API Request (Beta)* |
| `"... is not valid header value"` | Ottokit's header widget appended a newline. Don't fight it; put the secret in the body instead |
| `401` | `secret` in the body differs from `FORM_LEADS_SECRET` in Vercel, or Vercel wasn't redeployed after the var changed |
| `400 Nenhum campo recebido` | Ottokit tokens resolved empty — re-pick them from the trigger's sample data |
| Lead appears, name/phone/e-mail blank | `field_data` wasn't mapped, or the form's questions have unusual names — check `raw` on the row, then add an alias to `ALIASES` in `mapping.ts` |
| Formulário column shows `—` | `form_name` not set in the request body (see above) |
| Every lead posted to Slack twice | `SLACK_WEBHOOK_URL` is set in Vercel *and* the Ottokit Slack step is active — unset the Vercel var |
| Up to 10 min between submission and lead | The Facebook Lead Ads trigger polls; that interval is Ottokit's, not ours |
