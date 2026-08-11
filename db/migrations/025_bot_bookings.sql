-- ─────────────────────────────────────────────────────────────────────────────
-- Form lead -> booked evaluation, with a R$50 PIX deposit.
--
-- The bot owns this table end to end EXCEPT the approval decision: it proposes a
-- time, holds it, collects the receipt image, and (once a human approves) creates
-- the booking in Gestek. The CRM's only write is flipping status to
-- 'approved'/'rejected' from the /marketing panel — a person has to look at the
-- receipt, so that step is deliberately not automated.
--
-- The bot is not publicly reachable (internal Docker network only), so this table
-- is also the CRM -> bot channel: the bot polls for status='approved' rather than
-- the CRM calling it. See docs/superpowers/specs/2026-08-11-lead-to-booking-design.md.
--
-- Status flow:
--   proposed -> held -> proof_received -> approved -> booked
-- Terminals: expired (lead went quiet), rejected (receipt no good),
--            slot_lost (someone took the time while the deposit was pending).
--
-- agenda_id is null until 'booked' — the deposit-first ordering means nothing
-- exists in Gestek before then. That is the whole point of the flow: no ghost
-- bookings for leads who never pay.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bot_bookings (
  id              uuid primary key default gen_random_uuid(),
  lead_id         text not null,          -- bot_leads.id (normalized phone)
  form_lead_id    text references public.form_leads(id) on delete set null,
  phone           text not null,
  cliente_nome    text,
  -- The proposed appointment, stored as an instant. Gestek's own writes are UTC.
  slot_at         timestamptz not null,
  -- When the conversational hold lapses. The slot is NOT locked in Gestek during
  -- it; this is a promise the bot made, not a reservation.
  hold_expires_at timestamptz,
  status          text not null default 'proposed'
                    check (status in ('proposed','held','proof_received','approved',
                                      'booked','expired','rejected','slot_lost')),
  -- Object path inside the PRIVATE bot-comprovantes bucket. Receipts carry banking
  -- details, so unlike bot-media this is never public; the CRM renders a signed URL.
  proof_path      text,
  proof_at        timestamptz,
  -- Gestek's booking id, once created. Null before 'booked'.
  agenda_id       text,
  approved_by     text,                   -- auth.users email of whoever approved
  approved_at     timestamptz,
  -- How many nudges the scheduler has already sent for this booking (max 2).
  reminders_sent  integer not null default 0,
  note            text,                   -- failure detail, e.g. why Gestek refused
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The scheduler's hot query: "what is waiting on me right now".
create index if not exists bot_bookings_status_idx on public.bot_bookings (status, hold_expires_at);
-- Resolving an inbound message (or an approval) back to its open booking.
create index if not exists bot_bookings_lead_idx on public.bot_bookings (lead_id, status);

-- One open booking per lead at a time. Without this a lead who accepts a time,
-- goes quiet, then accepts another ends up with two live holds and two Gestek
-- bookings once both are approved. Partial, so the terminal states can accumulate
-- freely as history.
create unique index if not exists bot_bookings_one_open_per_lead
  on public.bot_bookings (lead_id)
  where status in ('proposed','held','proof_received','approved');

-- Per-lead pointer, mirroring pending_confirmation_agenda_id from migration 019:
-- non-null = this lead is mid-booking, so the pipeline routes its replies to the
-- booking flow instead of the qualifier. Cleared when the flow resolves.
alter table public.bot_leads add column if not exists pending_booking_id uuid;

-- Which form_leads row started this conversation. Set together with
-- origin = 'form_lead', and the link the bot follows to move `stage` (and with it
-- the Meta CAPI funnel events) as the conversation progresses.
alter table public.bot_leads add column if not exists form_lead_id text;

grant select on public.bot_bookings to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.bot_bookings to service_role;

-- Private bucket for PIX receipts. Explicitly NOT public, unlike bot-media
-- (migration 016): these images carry the lead's bank, name and often a partial
-- CPF. Access is via service-role signed URLs from the CRM only.
insert into storage.buckets (id, name, public)
values ('bot-comprovantes', 'bot-comprovantes', false)
on conflict (id) do nothing;
