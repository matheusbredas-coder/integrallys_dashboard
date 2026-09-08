-- When each call was actually placed, for the caller's kanban board on /marketing.
--
-- Migration 028 gave the board `call_attempts` (how many) and `last_call_at` (the
-- most recent one). Neither can answer "when was the 1st call?" once a 2nd has been
-- made: `last_call_at` is overwritten in place. This column keeps the whole history
-- so the notes drawer can list every attempt with its own date and time.
--
-- jsonb rather than timestamptz[]: PostgREST renders a timestamptz[] as Postgres
-- literals ("2026-09-04 14:32:00+00"), which is not the ISO string the rest of the
-- app's dates are, and parsing it in JS depends on engine leniency. A jsonb array of
-- ISO strings round-trips as exactly what was written.
--
-- Ordered oldest first, one entry per attempt, so entry N is the Nth call. It is
-- capped at MAX_CALL_ATTEMPTS by the app (features/form-leads/call-cadence.ts) for
-- the same reason `call_attempts` is: the DB stays permissive, the app stays strict.
-- Moving a lead back to "A ligar" empties it, exactly as that move already zeroes the
-- attempts and wipes the notes.
--
-- `not null default '[]'` so every existing row backfills in place as an empty
-- history. Rows already on the board keep their `last_call_at`, which the drawer
-- falls back to (see features/form-leads/call-log.ts) rather than showing nothing.

alter table public.form_leads
  add column if not exists call_log jsonb not null default '[]'::jsonb;
