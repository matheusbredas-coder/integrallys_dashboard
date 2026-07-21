-- ─────────────────────────────────────────────────────────────────────────────
-- Day-before appointment confirmations. The CRM's Vercel Cron fetches tomorrow's
-- Gestek bookings and hands them to the Lead Qualifier Bot, which sends a WhatsApp
-- template message and owns this table as the audit/idempotency record of what was
-- sent and how the patient replied. The bot writes as service role; the CRM only
-- reads it (dashboard visibility) and never writes to it directly.
--
-- status: sent -> confirmed | cancelled | cancel_failed, or failed if the template
-- send itself never went out. agenda_id is the Gestek booking id (also the PK of
-- gestek_agenda), so it doubles as the idempotency key — one row per booking.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.bot_appointment_confirmations (
  agenda_id     text primary key references public.gestek_agenda(id) on delete cascade,
  lead_id       text,                          -- bot_leads.id (normalized phone)
  phone         text not null,
  cliente_nome  text,
  start_at      timestamptz,
  status        text not null default 'sent'
                  check (status in ('sent','confirmed','cancelled','failed','cancel_failed')),
  sent_at       timestamptz,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists bot_appointment_confirmations_phone_idx
  on public.bot_appointment_confirmations (phone, status);

grant select on public.bot_appointment_confirmations to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.bot_appointment_confirmations to service_role;

-- Per-lead confirmation state (migration 016/018 precedent: bot-owned columns on
-- bot_leads). pending_confirmation_agenda_id non-null = the lead is mid-flow,
-- awaiting a confirm/cancel reply; it's cleared once resolved. origin marks a lead
-- created solely for a confirmation, so the qualifier stays silent for it afterward
-- (the bot only answers ad/website leads).
alter table public.bot_leads add column if not exists pending_confirmation_agenda_id text;
alter table public.bot_leads add column if not exists origin text; -- 'confirmation' | null

-- Widen the attendance-override source check (013_agenda_attendance.sql) to allow a
-- WhatsApp-driven cancellation alongside the existing 'chat'/'xlsx' sources.
alter table public.agenda_attendance drop constraint if exists agenda_attendance_source_check;
alter table public.agenda_attendance add constraint agenda_attendance_source_check
  check (source in ('chat','xlsx','whatsapp'));
