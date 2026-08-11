-- ─────────────────────────────────────────────────────────────────────────────
-- Morning-of reminder for bookings still awaiting a reply after the day-before
-- confirmation. The bot runs an in-process 9am BRT job (no n8n/Vercel cron
-- involved) that queries bot_appointment_confirmations for status='sent' rows
-- starting that day and sends a follow-up WhatsApp message.
--
-- reminder_sent_at is deliberately separate from status: status still tracks
-- the confirmation lifecycle (sent -> confirmed | cancelled), while
-- reminder_sent_at is only the idempotency guard for the reminder job itself
-- (NULL = not yet reminded), so a job re-run or process restart on the same
-- day never double-sends.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.bot_appointment_confirmations
  add column if not exists reminder_sent_at timestamptz;
