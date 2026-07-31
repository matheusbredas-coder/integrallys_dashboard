# Apps Script — Meta Instant Form leads → CRM

`form-leads-sync.gs` runs inside the Google Sheet that Meta's Lead Ads integration writes
into. Once a minute it POSTs any new row to the CRM's `/api/leads/form`, which stores it in
`public.form_leads` and fires a Slack notification.

This copy is the source of truth — edit it here and paste it into the Apps Script project,
not the other way round.

## Why polling and not an `onEdit` trigger

Meta writes rows through the Sheets API. Google's simple `onEdit` and `onFormSubmit`
triggers only run for edits a person makes in the browser, so they would never fire for
these rows. A time-driven trigger is the reliable option, and 1 minute is the fastest
Google allows.

## Setup

1. **Create the Slack webhook.** In Slack: *Apps → Incoming Webhooks → Add to Slack*, pick
   the channel, copy the URL.

2. **Set the CRM env vars** (Vercel dashboard → project → Settings → Environment
   Variables). The Vercel CLI on this machine isn't authenticated, so use the dashboard:
   - `SLACK_WEBHOOK_URL` — the webhook from step 1
   - `FORM_LEADS_SECRET` — a random string, e.g. `openssl rand -hex 32`

   Redeploy so they take effect.

3. **Apply the migration.** Run `db/migrations/021_form_leads.sql` in the Supabase SQL
   editor.

4. **Open the script.** In the Sheet: *Extensions → Apps Script*. Paste the contents of
   `form-leads-sync.gs` over `Code.gs`. Save.

5. **Set Script Properties.** *Project Settings → Script Properties → Add script property*:

   | Property | Value |
   |---|---|
   | `CRM_URL` | `https://integrallys-crm.vercel.app/api/leads/form` |
   | `FORM_LEADS_SECRET` | the same secret as step 2 |
   | `SHEET_NAME` | the tab Meta writes to (optional — defaults to the first tab) |

   The secret lives here, never in the script body, because the script body is in git.

6. **Silence the backlog.** If the sheet already has old leads you don't want announced,
   run `markAllRowsAsSynced` once. Skip this and the first run will post every existing
   row to Slack.

7. **Verify.** Run `testSendLastRow` and accept the authorization prompt. Check the
   Executions log, then the Slack channel and `/marketing`.

8. **Install the trigger.** Run `installTrigger`. It clears any existing trigger first, so
   it's safe to re-run.

## How it stays cheap

A 1-minute trigger fires 1440 times a day against a 90 min/day quota on consumer accounts
(6 h/day on Workspace). Each run starts with `getLastRow()` compared against a cached row
count in Script Properties and returns immediately if nothing was added — a fraction of a
second. Only a run that finds new rows reads any data. That's roughly 7–10 min/day, and it
stays flat as the sheet grows.

`UrlFetch` is capped at 20,000 calls/day and only fires for an actual new lead.

## What it does to the sheet

Adds one column, **`Sincronizado`**, holding the timestamp each row was sent. That's the
dedupe record: a row is only marked after the CRM returns 2xx, so a failed send is simply
retried next minute, and the mark survives rows being sorted or inserted. Don't delete or
reorder the column's contents — clearing a cell will resend that lead.

## Behaviour worth knowing

- **Duplicates.** If the sheet has a Meta lead-id column, the CRM also dedupes server-side
  and returns `{ duplicate: true }` without notifying. Without that column, the marker is
  the only guard.
- **Backlog.** At most 50 rows per run, to stay inside the 6-minute execution limit. A
  larger backlog drains over consecutive minutes.
- **Overlap.** `LockService` with a zero-second timeout: if a run is still going, the next
  minute is skipped rather than queued.
- **Slack down.** The CRM still records the lead and still returns 2xx, so the row is
  marked and won't be resent. The lead appears on `/marketing`; only the notification is
  lost. The failure is logged in the Vercel function logs.

## Troubleshooting

Check *Executions* in the Apps Script editor first.

| Symptom | Cause |
|---|---|
| `Missing Script Properties` | Step 5 not done, or a typo in a property name |
| `CRM responded 401` | `FORM_LEADS_SECRET` differs between Script Properties and Vercel |
| `CRM responded 502` | CRM reached the DB and failed — check Vercel logs; migration 021 may not be applied |
| Runs succeed, no Slack | `SLACK_WEBHOOK_URL` unset or revoked; the lead is still in `/marketing` |
| Nothing runs at all | `installTrigger` not run, or authorization prompt never accepted |
| A lead was sent twice | Its `Sincronizado` cell was cleared, or two triggers exist — run `installTrigger` again |
