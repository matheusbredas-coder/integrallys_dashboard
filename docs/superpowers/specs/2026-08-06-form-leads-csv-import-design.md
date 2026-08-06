# Form leads CSV import — design

## Problem

Leads sometimes need to enter the CRM from a Meta Ads Manager lead export (or a similar
flat CSV) instead of the live Gmail/n8n ingest. There's no way to bulk-add them today
without hand-entering rows.

## Goal

A CSV upload on the Marketing page that finds the leads not already in the CRM and adds
them — using the exact same identity, dedup, and Meta-reporting rules as the live ingest,
so an imported lead is indistinguishable from one that arrived in real time.

## Non-goals

- Updating existing leads' contact fields from the CSV. A row that matches an
  `external_id` already in `form_leads` is skipped entirely — untouched, not refreshed.
- Any stage other than `novo`. Import only ever creates leads at the funnel's opening
  stage; stage changes remain a human action on the dropdown.
- A generic multi-format importer. The parser targets the flat header→cell shape
  `mapSheetFields` already understands (Meta's lead export is one instance of it).

## Architecture / data flow

Reuses code that already exists for the webhook ingest (`/api/leads/form/route.ts`):
`mapSheetFields()` already maps a flat header→value row onto a lead, and
`form_leads_external_id_key` (migration 021) already lets an upsert with
`{ onConflict: "external_id", ignoreDuplicates: true }` tell "inserted" from "already had
it" in one statement. CSV import is the same mapping and the same dedup, batched instead
of one row per HTTP request, and driven by a signed-in user instead of a webhook secret.

```
pick file (browser)
  → read as text (FileReader)
  → previewFormLeadsCsv(text)   [server action, writes nothing]
      parse → map → classify: new / duplicate / invalid
      → show counts, Confirmar / Cancelar
  → (Confirmar) commitFormLeadsCsv(text)   [server action]
      parse → map → dedupe within file → one batched upsert
      → enqueueStageEvent(id, "novo") for each row actually inserted
      → revalidateTag("form-leads")
```

Nothing is written and no Meta event fires until the user clicks Confirmar — mirrors the
confirm/cancel pattern just added to the stage dropdown (`form-leads-table.tsx`), for the
same reason: the action is one a wrong file can't take back.

## Components

### `src/features/form-leads/csv.ts` (new, pure — no I/O)

Same shape as `mapping.ts` / `email-parse.ts`: pure functions, unit-tested directly.

- `parseCsv(text: string): Record<string, string>[]` — quote-aware RFC4180-ish parser.
  Handles quoted fields, embedded commas/newlines inside quotes, `""` as an escaped quote,
  and both `\r\n` and `\n` line endings. First row is headers; blank trailing lines are
  skipped.
- `parseCsvLeads(text: string): { rowNumber: number; lead: MappedLead }[]` — runs
  `parseCsv` then `mapSheetFields()` (from `mapping.ts`) per row.
- `dedupeWithinFile(rows)` — if two rows in the *same* file share a non-null
  `external_id`, the first wins and the rest are dropped before they ever reach the DB.
  Same "first entry wins" stance `mapping.ts` already takes on colliding headers.
- `isInvalidLead(lead: MappedLead): boolean` — true when `name`, `phone`, and `email` are
  all null. Nothing to identify the person by, so it's never inserted.

### `src/features/form-leads/actions.ts` (existing file, two new exports)

Both guarded by the existing `requireUser()` — same session check as
`updateFormLeadStage`.

- `previewFormLeadsCsv(csvText: string): Promise<{ ok: true; summary: { total: number; new: number; duplicate: number; invalid: number } } | { error: string }>`
  Parses, dedupes within-file, looks up which of the resulting `external_id`s already
  exist in `form_leads` (one `SELECT ... WHERE external_id = ANY(...)`), returns counts.
  Writes nothing.

- `commitFormLeadsCsv(csvText: string): Promise<{ ok: true; inserted: number; duplicate: number; invalid: number } | { error: string }>`
  Re-parses the same text, dedupes within-file, does **one** batched
  `.upsert(rows, { onConflict: "external_id", ignoreDuplicates: true }).select("id")` for
  the valid rows, then for each id actually returned (the genuine inserts) calls
  `enqueueStageEvent(id, "novo")` — identical to what the webhook route does for a brand
  new lead. Finishes with `revalidateTag("form-leads", { expire: 0 })`.

### `src/features/form-leads/form-leads-table.tsx` (existing file)

- An "Importar CSV" button next to the search box, opening a hidden
  `<input type="file" accept=".csv">`.
- On file pick: read as text client-side, call `previewFormLeadsCsv`, show an inline panel
  (styled like the existing `card` panels — no modal library in this app) with the counts
  and a two-line message ("X leads novos, Y já existem, Z inválidos" / "Uma vez
  confirmado, os novos leads são reportados ao Meta.") plus Confirmar/Cancelar.
- Confirmar calls `commitFormLeadsCsv`, shows a one-line result, `router.refresh()`s.
  Cancelar just clears the panel — no request sent.
- Failures surface through the same `error` state the stage dropdown already uses.

## Error handling

- Empty file / no rows parsed → preview shows "Nenhuma linha encontrada", nothing to
  confirm.
- Rows with no name/phone/email → counted as `invalid`, never inserted, never sent to
  Meta; visible in the preview count before commit.
- Not authenticated → `{ error: "Sessão expirada. Entre novamente." }`, same as every
  other form-lead action.
- DB error on the batched upsert → the whole commit fails with one error message; nothing
  partially applied silently. Retrying the whole file is safe — the unique index makes
  already-inserted rows show as duplicates the second time.
- Meta send failure for a newly inserted row → unchanged from today: `enqueueStageEvent`
  never throws, the row lands in `capi_events`, the daily cron drains it. Import
  success/failure is about the CRM rows, not Meta delivery.
- A CSV row with no `id` column (no `external_id`) is never deduped at the DB level
  (Postgres treats `NULL` as distinct in the unique index) — inherited, unchanged
  behavior from the live ingest path. Re-uploading the same such file twice would insert
  it twice. Not guarded against here, since Meta's actual lead export always carries an
  id.

## Testing

- `csv.test.ts` — quoted fields, embedded commas/newlines, `\r\n` vs `\n`, blank trailing
  lines, within-file duplicate `external_id`s, rows with no identity data.
- `actions.test.ts` (or extended) — mock Supabase + `enqueueStageEvent`: preview never
  writes; commit inserts once, skips known duplicates, calls `enqueueStageEvent` only for
  genuine inserts.
