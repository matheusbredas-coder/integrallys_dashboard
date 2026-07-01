-- Lead Qualifier Bot persistence. The bot (service role) is the only writer;
-- the CRM reads leads_view. cliente_id/campaign are forward-compat hooks for a
-- future reactivation campaign (unused for now).
create table if not exists public.leads (
  id               text primary key,            -- phone / channel lead id
  channel          text not null,               -- 'local' | 'evolution' | ...
  name             text,
  interest         text,                         -- ad/product context
  pain_point       text,
  context          text,                         -- qualification: situation/frequency
  funnel_stage     text not null default 'new',
  follow_up_step   integer not null default 0,
  block_until      timestamptz,                  -- null = not blocked
  block_permanent  boolean not null default false,
  cliente_id       text,                         -- FUTURE (reactivation): link to Clientes; nullable, unused now
  campaign         text,                         -- FUTURE (reactivation): campaign tag; nullable, unused now
  last_activity_at timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

create table if not exists public.lead_messages (
  id          bigint generated always as identity primary key,
  lead_id     text not null references public.leads(id) on delete cascade,
  role        text not null,                     -- 'lead' | 'bot' | 'human'
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists lead_messages_lead_idx on public.lead_messages (lead_id, id);
create index if not exists leads_last_activity_idx on public.leads (last_activity_at);

create or replace view public.leads_view as
select
  l.*,
  (l.block_permanent or (l.block_until is not null and l.block_until > now())) as is_blocked,
  (select count(*) from public.lead_messages m where m.lead_id = l.id)                                as message_count,
  (select m.content    from public.lead_messages m where m.lead_id = l.id order by m.id desc limit 1) as last_message,
  (select m.created_at from public.lead_messages m where m.lead_id = l.id order by m.id desc limit 1) as last_message_at
from public.leads l;

grant select on public.leads, public.lead_messages, public.leads_view
  to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.leads         to service_role;
grant insert, update, delete on public.lead_messages to service_role;

-- Public bucket for bot media (before/after, voucher cards, testimonial clips).
insert into storage.buckets (id, name, public)
values ('bot-media', 'bot-media', true)
on conflict (id) do nothing;
