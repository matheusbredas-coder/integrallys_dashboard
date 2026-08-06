-- Protocolo (treatment programme) a form lead is being worked for, shown as its own column
-- on /marketing next to the lead's contact details.
--
-- Every lead today arrives from the emagrecimento funnel, so the column is NOT NULL with that
-- default: existing rows are backfilled by the same statement, and the ingest route needs no
-- change to keep working.
--
-- Deliberately plain text with no CHECK constraint, the same stance `stage` takes in 021. When
-- a second protocolo exists it can come from the "Lead Nova" email (add an alias to
-- `ALIASES` in src/features/form-leads/mapping.ts) or be set by hand — a code change, not a
-- migration. The DB stays permissive; the app stays strict.

alter table public.form_leads
  add column if not exists protocolo text not null default 'emagrecimento';
