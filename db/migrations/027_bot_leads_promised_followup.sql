-- The day a lead named herself in the "deixa eu pensar" objection flow
-- ("ainda hoje ou amanhã?") — Lead Qualifier Bot's src/followup.ts fires the
-- promised-day message on this date instead of the generic step 1 cadence.
-- Mirrors pending_confirmation_agenda_id / pending_booking_id: one nullable
-- pointer on the lead row, cleared once it resolves (fires, or she replies
-- again before then).

alter table public.bot_leads
  add column if not exists promised_follow_up_at timestamptz;
