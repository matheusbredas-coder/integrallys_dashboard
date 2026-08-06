-- Meta Ads Instant Form leads. An n8n workflow watches Gmail for the "Lead Nova" notification
-- email and POSTs each message to /api/leads/form, which parses the lead out of it and
-- inserts it here. See docs/gmail-form-leads.md for the n8n side.
--
-- (Comment updated after this migration was applied; the DDL below is unchanged. The original
-- ingest was a Google Sheet polled by a bound Apps Script — which is why `sheet_row` exists
-- and is null on every lead since — then an Ottokit webhook on Meta's Facebook Lead Ads
-- trigger, retired 2026-08 in favour of the Gmail workflow.)
--
-- Self-contained: no dependency on the still-pending campaigns / bot_leads rename
-- migrations (016-018). Same stance as 020_wa_links.sql.
--
-- These are NOT bot_leads. bot_leads are WhatsApp conversations the qualifier bot owns and
-- advances automatically (funnel_stage is written by the bot); form_leads arrive from a
-- paid ad form with no conversation attached, and their `stage` is only ever moved by a
-- human in the Marketing page. Separate tables, separate lifecycles.

create table if not exists public.form_leads (
  id            text primary key default gen_random_uuid()::text,
  source        text not null default 'meta_instant_form',
  external_id   text,          -- Meta lead id when the sheet carries one; null otherwise
  sheet_row     integer,       -- legacy: origin row of the retired Sheet; null for Ottokit
  campaign      text,
  form_name     text,
  name          text,
  phone         text,          -- digits only, country code included (see mapping.ts)
  email         text,
  raw           jsonb not null default '{}'::jsonb,  -- every sheet column, verbatim
  stage         text not null default 'novo',        -- see FORM_LEAD_STAGES in types.ts
  notes         text,
  submitted_at  timestamptz,   -- when the lead filled the form (from the sheet)
  created_at    timestamptz not null default now(),  -- when we ingested it
  updated_at    timestamptz not null default now()
);

-- Server-side dedupe: re-POSTing the same Meta lead id is a no-op.
--
-- Deliberately NOT a partial index. Postgres already treats NULLs as distinct in a unique
-- index, so rows with no Meta lead id never collide with each other — and unlike a partial
-- index, a plain one can serve as an ON CONFLICT target, which is what lets the ingest
-- route use `upsert(..., { onConflict: "external_id", ignoreDuplicates: true })` to tell
-- "inserted" from "already had it" in a single statement (PostgREST can't emit the
-- `WHERE` clause that inferring a partial index would require).
--
-- Rows with a null external_id get no DB-level dedupe. In practice Ottokit always sends
-- Meta's lead id, so that case only arises from a hand-rolled POST.
create unique index if not exists form_leads_external_id_key
  on public.form_leads (external_id);

create index if not exists form_leads_created_idx on public.form_leads (created_at desc);
create index if not exists form_leads_stage_idx   on public.form_leads (stage);

-- `stage` is deliberately plain text with no CHECK constraint: the allowed values live in
-- one TypeScript constant (FORM_LEAD_STAGES) that the server action validates against, so
-- adding a stage later is a code change rather than a migration. The DB stays permissive;
-- the app stays strict.

grant select on public.form_leads to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.form_leads to service_role;
