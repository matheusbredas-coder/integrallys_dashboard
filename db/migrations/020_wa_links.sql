-- WhatsApp click-to-chat tracked links. The Marketing page (service role) creates named
-- links; the public /r/<slug> redirect route logs one row per click and 302s to wa.me.
-- Self-contained: no dependency on the still-pending campaigns / bot_leads rename migrations.
--
-- Click counts are derived from wa_link_clicks via wa_links_view (same subquery pattern as
-- bot_leads_view in migration 016) rather than a denormalized counter — this keeps the
-- redirect path a single INSERT with no update race between concurrent clicks.

create table if not exists public.wa_links (
  id          text primary key default gen_random_uuid()::text,
  slug        text not null unique,          -- short public token that appears in /r/<slug>
  name        text not null,                 -- human label shown in the Marketing list
  phone       text not null,                 -- digits only, including country code (e.g. 5541999998888)
  message     text not null default '',      -- prefilled wa.me text (may be empty)
  created_at  timestamptz not null default now()
);

create table if not exists public.wa_link_clicks (
  id          bigint generated always as identity primary key,
  link_id     text not null references public.wa_links(id) on delete cascade,
  clicked_at  timestamptz not null default now(),
  referer     text,
  user_agent  text
);

create index if not exists wa_link_clicks_link_idx on public.wa_link_clicks (link_id, clicked_at);
create index if not exists wa_links_created_idx on public.wa_links (created_at desc);

-- Read model for the Marketing list: total clicks, clicks in the last 24h/7d, and the
-- most recent click, all derived from wa_link_clicks so counts can never drift.
create or replace view public.wa_links_view as
select
  l.*,
  (select count(*) from public.wa_link_clicks c where c.link_id = l.id)                                              as click_count,
  (select count(*) from public.wa_link_clicks c where c.link_id = l.id and c.clicked_at > now() - interval '1 day')  as clicks_24h,
  (select count(*) from public.wa_link_clicks c where c.link_id = l.id and c.clicked_at > now() - interval '7 days') as clicks_7d,
  (select max(c.clicked_at) from public.wa_link_clicks c where c.link_id = l.id)                                     as last_clicked_at
from public.wa_links l;

grant select on public.wa_links, public.wa_link_clicks, public.wa_links_view
  to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.wa_links       to service_role;
grant insert                  on public.wa_link_clicks to service_role;
