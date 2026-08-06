# n8n Gmail — "Lead Nova" emails → CRM

An n8n workflow on the Easypanel VPS watches Gmail for messages with the subject
**"Lead Nova"**, forwards the message to this app's `/api/leads/form`, and the route parses
the lead out of the email body, stores it in `public.form_leads` and shows it under
**Leads do formulário (Meta)** on `/marketing`.

Workflow JSON: [`n8n/workflows/leads-gmail.json`](../n8n/workflows/leads-gmail.json).

```
Gmail Trigger  (subject:"Lead Nova", every minute)
  └─→ HTTP Request  POST /api/leads/form     ← the step that reaches this app
        └─→ Gmail: Add Label "CRM ingerido"  ← best-effort receipt in the inbox
```

This replaced an **Ottokit** workflow on Meta's *Facebook Lead Ads → New Lead* trigger
(retired 2026-08; its webhook step could not be made to deliver). Ottokit before that
replaced a Google Sheet polled by a bound Apps Script (retired 2026-08-04). Both older
payload shapes are still accepted by the route, so replaying an old payload works.

## n8n → CRM: the contract

n8n does **no parsing**. It posts four keys and the CRM derives every lead field from `body`:

| Key | Source | Used for |
|---|---|---|
| `message_id` | Gmail's message id | Dedupe fallback, and kept in `form_leads.raw` |
| `subject` | The email subject | Kept in `raw` for tracing |
| `body` | The email's plain text | **Everything** — parsed by `parseLeadEmail` |
| `received_at` | When Gmail received it | `submitted_at` fallback if the email carries no date |

Parsing lives in `src/features/form-leads/email-parse.ts` rather than an n8n Code node so it
is unit-tested (`email-parse.test.ts`) and so a change to the sending automation's template is
a test, not an edit in a browser.

### Credential

A **Header Auth** credential named `CRM - form leads secret`:

| Field | Value |
|---|---|
| Name | `Authorization` |
| Value | `Bearer <FORM_LEADS_SECRET>` |

`FORM_LEADS_SECRET` lives in the Vercel dashboard (project → Settings → Environment
Variables). Read the existing value rather than generating a new one; rotating it means
changing it in both places at once. Keeping it in a credential rather than a literal header
is what keeps it out of the workflow JSON committed to this repo.

Unlike Ottokit — whose header widget appended a newline and broke its own HTTP client — n8n
sends headers cleanly, so the secret goes in the header. The route still accepts a `secret`
key in the body for that historical reason; don't use it from here.

### Gmail Trigger

| Setting | Value |
|---|---|
| Poll Times | Every Minute |
| Filters → Search | `subject:"Lead Nova"` |
| **Simplify** | **off** |

**Simplify off is the part that matters.** With it off the node parses the raw message and
emits `text` (the plain-text body) alongside `html`, `subject` and `date`. Simplified output
is a reduced set and may not carry the body at all — and a request with an empty `body` is
rejected by the route with `400 Nenhum campo recebido`.

Whatever you choose, **confirm against the node's own OUTPUT panel** that the body is under
`text`. The HTTP body below falls back to `textAsHtml` then `html` if it isn't — the parser
strips tags — but it never falls back to `snippet`, which Gmail truncates to ~200 characters
and would silently cost you fields.

### HTTP Request

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `https://integrallys-crm.vercel.app/api/leads/form` |
| Authentication | Generic Credential Type → Header Auth → `CRM - form leads secret` |
| Send Body | on |
| Specify Body | **Using JSON** |
| Retry On Fail | on — 3 tries, 5000 ms apart |

Body:

```
={{ JSON.stringify({
  message_id:  $json.id,
  subject:     $json.subject,
  body:        $json.text || $json.textAsHtml || $json.html,
  received_at: $json.date
}) }}
```

**One expression building the whole object, not a JSON template with `={{ }}` in the values.**
An email body is multi-line and routinely contains quotes and backslashes; substituted into a
raw JSON template those characters break the JSON and n8n sends a malformed request.
`JSON.stringify` escapes them. This is the same pattern the `gestek-*` workflows use.

### Add Label (optional)

Applies `CRM ingerido` to the message so "did this lead get in?" is answerable from the inbox.
Set **On Error → Continue** so a labeling failure can't fail an execution whose lead was
already stored. The workflow JSON ships with a `CRM_INGERIDO_LABEL_ID` placeholder — create
the label in Gmail and pick it from the dropdown, or delete the node.

## The email format

The parser reads one `Label: value` per line:

```
Você recebeu uma nova lead!

Nome completo: Ana Souza
Telefone: +55 (41) 99999-8888
E-mail: ana@example.com
Campanha: Harmonização - Julho
Formulário: Avaliação gratuita
Lead ID: l_10223344
Data de envio: 31/07/2026 14:23
```

- **No per-label configuration to maintain.** Labels are matched against the alias lists in
  `ALIASES` (`src/features/form-leads/mapping.ts`), the same ones the Meta form questions went
  through — `Nome completo`, `Telefone`, `E-mail`, `Campanha`, `Formulário`, `Lead ID`,
  `Data de envio` and their English/underscore variants all map. Add a question to the form
  and it flows into `raw` with no config change; only a genuinely new *label wording* for a
  mapped column needs an alias added.
- **Every recognized line is kept in `raw`**, mapped or not, so an unmapped question is
  recoverable later.
- The value may contain colons (`Data: 31/07/2026 14:23:05`) — the split is on the first one.
- Bulleted lines (`- Nome: Ana`) are read. Lines with no label, and labels over 60 characters,
  are ignored. A short footer line containing a colon does become an unmapped key in `raw`;
  that's deliberate, since a tighter rule would drop real form questions.
- An HTML-only body is stripped to text first, entities included.

## Deduplication

Server-side, on `form_leads.external_id` (unique index, migration 021), resolved by
`resolveExternalId`:

1. **Meta's lead id** when the email carries one (any of `Lead ID`, `ID do lead`, `id`).
2. Otherwise **`gmail:<message_id>`** — Gmail message ids are unique and never reused.

So re-sending an email can never create a second row or a second notification: an n8n retry, a
manual re-execution, or a re-poll all settle as `duplicate: true`. Using Meta's real lead id
when it's present is also what let the Ottokit and Gmail paths run in parallel during the
cutover without duplicating leads.

Rows land with `source = 'gmail_lead_nova'` (Ottokit-era rows kept `meta_instant_form`). The
column isn't rendered anywhere — it's there so the two eras stay distinguishable in Supabase.

## Responses

| Response | Meaning |
|---|---|
| `{ "ok": true, "id": "…", "duplicate": false }` | Lead stored, `/marketing` refreshed |
| `{ "ok": true, "duplicate": true }` | Already ingested — no second row, no notification. A settled success; don't retry |
| `401` | The header secret doesn't match `FORM_LEADS_SECRET`, or Vercel wasn't redeployed after the var changed |
| `400 Nenhum campo recebido` | The body arrived empty or had no `Label: value` line. `received` echoes the top-level key *names* (never values) so a misconfigured sender is diagnosable from n8n's own panel |
| `502` | The DB write failed. The lead was **not** stored — this is what the retries are for |

Because `502` means "not stored" and `duplicate: true` means "already stored", retrying is
safe in both directions: it cannot drop a lead and it cannot duplicate one.

## Notifications

`SLACK_WEBHOOK_URL` is left **unset** in Vercel — the "Lead Nova" email is itself the
notification. Setting it makes the CRM post every new lead to Slack as well
(`notifyNewFormLead`); nothing else changes if you do.

## Testing

Against a local dev server (`npm run dev`):

```bash
curl -sS -X POST http://localhost:3000/api/leads/form \
  -H "Authorization: Bearer $FORM_LEADS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"message_id":"test_msg_1","subject":"Lead Nova",
       "received_at":"2026-08-05T13:00:00Z",
       "body":"Nome completo: Teste n8n\nTelefone: +55 41 99999-8888\nE-mail: teste@example.com\nLead ID: l_test_1"}'
```

First call returns `duplicate: false`, a second returns `duplicate: true`. The lead should
appear on `/marketing` with the phone normalized to `5541999998888` and a working `wa.me`
link. Delete the test row from Supabase afterwards.

In n8n, pin a real "Lead Nova" item on the Gmail Trigger and execute the HTTP Request node on
its own before activating the workflow.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `400 Nenhum campo recebido` | `body` arrived empty — Simplify is on and the trigger emits no `text`, or the expression points at the wrong key. Check the trigger's OUTPUT panel |
| `401` | Header credential value isn't exactly `Bearer <secret>`, or Vercel wasn't redeployed after `FORM_LEADS_SECRET` changed |
| Lead appears, name/phone/e-mail blank | The email's labels don't match any alias. Look at `raw` on the row, then add the label to `ALIASES` in `mapping.ts` |
| Only the first line of the email parsed | The body came through as `snippet` (~200 chars). Fix the expression to use `text` |
| Malformed JSON / n8n sends nothing | The body was built as a JSON template with inline `={{ }}` instead of one `JSON.stringify` expression — a quote or newline in the email broke it |
| Nothing triggers | The Gmail search doesn't match. `subject:"Lead Nova"` is exact-phrase; confirm the real subject in Gmail's own search bar first |
| Up to 1 min between email and lead | The Gmail Trigger polls; that interval is n8n's, not ours |
| Every lead posted to Slack | `SLACK_WEBHOOK_URL` is set in Vercel — unset it |
