-- Reactivation campaign storage. The dashboard writes campaign drafts + audience;
-- the bot worker (service role) reads published campaigns and sends. Copy funnel
-- (two tracks) lives in campaigns.tracks; frozen audience in campaigns.audience_snapshot.
-- Requires migration 017 (leads -> bot_leads rename) to have been applied first;
-- 017 is pending/uncommitted as of this migration's authoring.

create table if not exists public.campaigns (
  id                text primary key default gen_random_uuid()::text,
  name              text not null,
  status            text not null default 'draft',   -- draft | published | paused | done
  tracks            jsonb not null default '{}'::jsonb,       -- ReactivationFunnel copy schema
  audience_filter   jsonb not null default '{}'::jsonb,       -- last-visit / procedure / spend / never-rebooked
  keyword_rosto     jsonb not null default '[]'::jsonb,
  keyword_medidas   jsonb not null default '[]'::jsonb,
  keyword_reserved  jsonb not null default '[]'::jsonb,
  audience_snapshot jsonb,                                     -- frozen [{cliente_id, track}] at publish
  audience_count    integer not null default 0,
  sent_count        integer not null default 0,
  delivered_count   integer not null default 0,
  replied_count     integer not null default 0,
  booked_count      integer not null default 0,
  published_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Reactivation routing/telemetry on bot_leads (existing campaign/cliente_id hooks reused).
alter table public.bot_leads add column if not exists track            text;         -- 'rosto' | 'medidas'
alter table public.bot_leads add column if not exists last_template_at timestamptz;  -- last outbound template time

create index if not exists bot_leads_campaign_idx on public.bot_leads (campaign);

grant select on public.campaigns to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.campaigns to service_role;
