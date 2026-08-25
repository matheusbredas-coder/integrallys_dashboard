-- Per-lead state for pinned, branching outbound scripts (Lead Qualifier Bot's
-- src/script/). Mirrors pending_confirmation_agenda_id / pending_booking_id:
-- one pointer on the lead row, cleared as the flow resolves.

alter table public.bot_leads
  add column if not exists script_id text,
  add column if not exists script_step_id text;
