-- Outbox for Meta Conversions API events.
--
-- When a form lead is moved to a high-intent stage on /marketing, the CRM tells Meta about it
-- so the Leads campaign can optimize for leads that actually qualify, book and buy instead of
-- for raw form volume. See docs/meta-capi.md.
--
-- Why a table and not a plain fire-and-forget call (the stance lib/slack.ts takes): a dropped
-- Slack ping costs a notification, while a dropped conversion costs the campaign a training
-- signal that never comes back. The stage change is a human action nobody repeats. So the
-- event is recorded first and sent second, and /api/cron/capi drains whatever didn't land.
--
-- PRIVACY: `payload` holds the request body ALREADY HASHED (SHA-256, see features/capi/hash.ts).
-- This table must never become a second copy of a lead's personal data — the only readable
-- values in it are the lead's row id and the event name.

create table if not exists public.capi_events (
  id            text primary key default gen_random_uuid()::text,
  form_lead_id  text not null references public.form_leads(id) on delete cascade,
  event_name    text not null,          -- LeadQualificado | Schedule | Purchase
  event_id      text not null,          -- deterministic: <form_lead_id>:<event_name>
  event_time    bigint not null,        -- unix seconds, frozen at enqueue
  payload       jsonb not null,         -- the CAPI event, hashed; never plaintext PII
  status        text not null default 'pending',  -- pending | sent | failed | expired
  attempts      integer not null default 0,
  error_code    integer,                -- Meta's error.code from the last attempt
  error_message text,
  fbtrace_id    text,                   -- the handle Meta support asks for
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One event per lead per event name, forever.
--
-- Stages are moved by hand, so a lead dragged qualificado -> contatado -> qualificado is
-- routine. Without this, each round trip would report a fresh conversion and inflate exactly
-- the numbers this feature exists to make trustworthy. A plain (not partial) unique index so
-- it can serve as an ON CONFLICT target for PostgREST's upsert, the same reasoning as
-- form_leads_external_id_key in migration 021.
create unique index if not exists capi_events_dedup_key
  on public.capi_events (form_lead_id, event_name);

-- Drives the cron drain. Partial, because 'pending' is the short tail: almost every row
-- settles as 'sent' seconds after it is written.
create index if not exists capi_events_pending_idx
  on public.capi_events (created_at) where status = 'pending';

-- `status` is deliberately plain text with no CHECK constraint, the same stance `stage` takes
-- in 021: the allowed values live in TypeScript (CAPI_EVENT_STATUSES in features/capi/queue.ts).
-- The DB stays permissive; the app stays strict.

grant select on public.capi_events to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.capi_events to service_role;
