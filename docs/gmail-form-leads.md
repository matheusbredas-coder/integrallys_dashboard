# n8n Gmail — "Lead Nova" leads → CRM

An n8n workflow on the Easypanel VPS watches Gmail for the **"Lead Nova"** notification email,
pulls the lead's fields out of it, and POSTs them as flat JSON to this app's
`/api/leads/form`. The route stores the lead in `public.form_leads`, and it appears under
**Leads do formulário (Meta)** on `/marketing`.

```
Gmail Trigger  (subject:"Lead Nova")
  └─→ (extract the fields — n8n's side)
        └─→ HTTP Request  POST /api/leads/form   ← the step that reaches this app
```

**n8n owns the extraction.** The app used to receive the raw email text and parse it; that was
dropped in favour of n8n sending named fields, which is simpler on both sides and means a
change to the email template is an n8n change, not a deploy.

This replaced an **Ottokit** workflow on Meta's *Facebook Lead Ads → New Lead* trigger
(retired 2026-08; its webhook step could not be made to deliver), which itself replaced a
Google Sheet polled by a bound Apps Script. Both older payload shapes are still accepted, so
replaying an old payload works.

Leads can also arrive by **CSV import** on `/marketing` (a Meta Ads Manager export) — same
table, same dedupe. See the CSV import feature for that path.

## The contract

POST flat JSON. Every key is a field name; the route matches it against the alias lists in
`ALIASES` (`src/features/form-leads/mapping.ts`).

```json
{
  "id":           "2558111507959750",
  "full_name":    "Angelica Fernandes",
  "email":        "angelica_fernandes2@gmail.com",
  "phone_number": "+5527996464078",
  "created_time": "2026-08-05T14:23:00-03:00",
  "message_id":   "1994a1f0c2d3e4f5"
}
```

| Key | Column | Notes |
|---|---|---|
| `id` | `external_id` | Meta's lead id. **The dedupe key** — send it if you have it |
| `full_name` | `name` | |
| `email` | `email` | Lowercased on the way in |
| `phone_number` | `phone` | Punctuation stripped → `5527996464078` |
| `created_time` | `submitted_at` | When the lead filled the form. ISO-8601 or `DD/MM/YYYY HH:MM` |
| `message_id` | — | Gmail's message id. Kept in `raw`, and the dedupe fallback |

### Names are forgiving

Each column has an alias list, matched on a normalized key — case, accents and punctuation are
collapsed, so `full_name`, `Full Name`, `Nome completo` and `NOME-COMPLETO` are the same field.
Both English and pt-BR work:

| Column | Accepted names |
|---|---|
| `external_id` | `lead id`, `id do lead`, `leadid`, `id` |
| `name` | `full name`, `nome completo`, `nome e sobrenome`, `nome`, `name` |
| `phone` | `phone number`, `telefone celular`, `numero de telefone`, `whatsapp`, `telefone`, `celular`, `phone` |
| `email` | `email`, `e mail`, `endereco de email` |
| `campaign` | `campaign name`, `nome da campanha`, `campanha`, `campaign` |
| `form_name` | `form name`, `nome do formulario`, `formulario`, `form` |
| `submitted_at` | `created time`, `data de envio`, `data e hora`, `submitted at`, `horario de criacao`, `data` |

Matching is **exact on the normalized name, never a substring** — that's what stops
`campaign_id` being read as the campaign name, and `form_id` as the form name.

**Anything unrecognized is still kept**, verbatim, in `form_leads.raw`. So you can send extra
answers (`"Qual seu incômodo?": "rugas"`) with no config change here, and promote them to a
column later. Nothing is lost by sending too much.

### The two extra questions (bairro, quanto quer perder)

From 08/09/2026 the form also asks the lead **which neighbourhood she lives in** and **how much
weight she wants to lose**. Neither has a column, and neither needs one: they ride along in
`raw` and are read back at display time by `features/form-leads/form-answers.ts`. There is
nothing to configure in n8n beyond passing the answers through — send them under whatever name
Meta gives them.

Matching is looser than the table above on purpose. Those aliases match a whole normalized
label exactly, which is right for n8n's short machine names (`full_name`); these two are named
after the form's own *question*, a full sentence that whoever edits the form in Ads Manager can
reword at any time. So `form-answers.ts` tries exact aliases first and then falls back to
keywords: anything containing `bairro` for the first, and for the second anything pairing a verb
of losing (`perder`, `eliminar`, `emagrecer`) with a want, plus the literal `quantos quilos`.

**The weight patterns never match on `peso` alone**, which is what stops "Qual seu peso atual?"
being read as the goal. If the form ever asks both, the goal still wins. Covered by
`form-answers.test.ts` — add a case there before rewording a question in a way you're unsure of.

## Setting up the HTTP Request node

### Credential

A **Header Auth** credential:

| Field | Value |
|---|---|
| Name | `Authorization` |
| Value | `Bearer <FORM_LEADS_SECRET>` |

`FORM_LEADS_SECRET` lives in the Vercel dashboard (project → Settings → Environment
Variables). Read the existing value rather than generating a new one; rotating it means
changing it in both places at once. Keeping it in a credential rather than a literal header is
what keeps it out of any workflow JSON committed to this repo.

The route also accepts a `secret` key in the body. That exists only because Ottokit's header
widget appended a newline and broke its own HTTP client; n8n sends headers cleanly, so use the
header.

### Node settings

| Setting | Value |
|---|---|
| Method | `POST` |
| URL | `https://integrallys-crm.vercel.app/api/leads/form` |
| Authentication | Generic Credential Type → Header Auth |
| Send Body | on |
| Specify Body | **Using JSON** |
| Retry On Fail | on — 3 tries, 5000 ms apart |
| Never Error | **off** — a failed lead must show as a failed execution |

Build the body as **one expression**, not a JSON template with `={{ }}` inside the values:

```
={{ JSON.stringify({
  id:           $json.leadId,
  full_name:    $json.nome,
  email:        $json.email,
  phone_number: $json.telefone,
  created_time: $json.data,
  message_id:   $json.id
}) }}
```

Substituted into a raw JSON template, any quote, backslash or newline in a lead's own answer
breaks the JSON and n8n sends a malformed request. `JSON.stringify` escapes them. Same pattern
the `gestek-*` workflows use.

When the workflow is built, export it to `n8n/workflows/` alongside the `gestek-*.json` files —
placeholder credential ids, no secrets in the file.

## Deduplication

Server-side, on `form_leads.external_id` (unique index, migration 021), resolved by
`resolveExternalId`:

1. **Meta's lead id** when the payload carries one.
2. Otherwise **`gmail:<message_id>`** — Gmail message ids are unique and never reused.

So re-sending a lead can never create a second row or a second notification: an n8n retry, a
manual re-execution, or a re-poll all settle as `duplicate: true`. Send at least one of the
two; with neither, the row has a null `external_id` and Postgres treats NULLs as distinct, so
that lead is never deduped at all.

## Responses

| Response | Meaning |
|---|---|
| `{ "ok": true, "id": "…", "duplicate": false }` | Lead stored, `/marketing` refreshed |
| `{ "ok": true, "duplicate": true }` | Already ingested — no second row, no notification. A settled success; don't retry |
| `401` | The header secret doesn't match `FORM_LEADS_SECRET`, or Vercel wasn't redeployed after the var changed |
| `400 Nenhum campo recebido` | The body had no usable keys. `received` echoes the top-level key *names* (never values) so a misconfigured sender is diagnosable from n8n's own panel |
| `502` | The DB write failed. The lead was **not** stored — this is what the retries are for |

Because `502` means "not stored" and `duplicate: true` means "already stored", retrying is safe
in both directions: it cannot drop a lead and it cannot duplicate one.

## What happens when a lead lands

A stored lead shows up in three places, all of them automatic — the ingest route is the only
thing that has to run:

| Where | How it gets there |
|---|---|
| **Slack** | `notifyNewFormLead` posts the "Novo lead — Meta Ads" block: nome, telefone, bairro, quanto quer perder. Requires `SLACK_WEBHOOK_URL` |
| **Quadro de ligações → "A ligar"** | Nothing writes it. `board_column` starts `null`, and `boardColumnFor` reads `null` as the first column (`A_LIGAR`), so a brand new lead is on the board the moment the row exists. See `features/form-leads/board-columns.ts`. Her bairro and weight goal show as read-only rows on the card behind **Notas** |
| **Leads do formulário (Meta)** | The table below the board, which lists every row |

All three only fire on a genuine insert. A duplicate returns before any of them.

### Slack

The message carries **nome, telefone, bairro and quanto quer perder**. Campaign and form name
were dropped from it on 08/09/2026: there is one campaign and one form, so both lines repeated
themselves on every alert while the two answers that decide who to call first were missing. A
lead from the older form still gets a well-formed message — the two rows read `—`.

`SLACK_WEBHOOK_URL` must be set in Vercel **Production** and the app redeployed afterwards — a
Vercel env var only reaches the running app on the next deployment. It was deliberately left
unset until 08/09/2026, on the theory that the "Lead Nova" email was notification enough;
Matheus asked for the Slack ping as well.

Unsetting the var turns the notification back off with no code change: `postSlackMessage`
returns `false` when there's no webhook, and the route only logs a failure when one is
configured, so nothing starts crying wolf.

### The board

There is nothing to configure and nothing to write. The bairro and the weight goal appear as
read-only rows on the lead's card (the **Notas** drawer), above the observations field —
deliberately *not* seeded into that textarea, which is the caller's own text, gets rewritten
after every call, and is wiped when a card goes back to "A ligar". What the lead herself
submitted must not be losable that way.

Two things could take a new lead *off* "A ligar", and neither happens on ingest: someone dragging the card to another column, or
`updateFormLeadBoard` being called. The funnel `stage` (`novo`, `contatado`, …) never moves a
card — board and funnel are separate fields on purpose, see the comment on `BOARD_COLUMNS` in
`features/form-leads/types.ts`.

## Testing

Against a local dev server (`npm run dev`):

```bash
curl -sS -X POST http://localhost:3000/api/leads/form \
  -H "Authorization: Bearer $FORM_LEADS_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"id":"l_test_1","full_name":"Teste n8n","email":"teste@example.com",
       "phone_number":"+55 41 99999-8888","created_time":"2026-08-05T14:23:00-03:00"}'
```

First call returns `duplicate: false`, a second returns `duplicate: true`. The lead should
appear on `/marketing` with the phone normalized to `5541999998888` and a working `wa.me`
link. Delete the test row from Supabase afterwards.

In n8n, pin a real "Lead Nova" item on the trigger and execute the HTTP Request node on its own
before activating the workflow.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `400 Nenhum campo recebido` | Every key resolved empty — re-pick the expressions from the trigger's sample data |
| `401` | Header credential value isn't exactly `Bearer <secret>`, or Vercel wasn't redeployed after `FORM_LEADS_SECRET` changed |
| Lead appears, name/phone/e-mail blank | The key names don't match any alias. Look at `raw` on the row, then either rename the key in n8n or add the alias to `ALIASES` in `mapping.ts` |
| Malformed JSON / n8n sends nothing | The body was built as a JSON template with inline `={{ }}` instead of one `JSON.stringify` expression |
| The same lead lands twice | Neither `id` nor `message_id` was sent, so there was nothing to dedupe on |
| Nothing triggers | The Gmail search doesn't match. `subject:"Lead Nova"` is exact-phrase; confirm the real subject in Gmail's own search bar first |
| No Slack message for a new lead | `SLACK_WEBHOOK_URL` missing from Vercel Production, or set but not redeployed since. The route's response carries `"slack": false` when the post didn't go out |
| A new lead isn't on the board | Check `board_column` on the row: only a value other than `null` moves her out of "A ligar". A terminal column (`qualificado`/`agendado`/`removido`) also hides her after 14 days |
