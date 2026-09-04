-- Half hours the clinic decides BY HAND, from the "Agenda da semana" grid on
-- /marketing. One row per half hour, per day — every row is the clinic overruling
-- what the diary says.
--
-- Why this table exists at all: Gestek's own "lembretes"/blocks never reach its
-- API (verified with the vendor), so a time the clinic reserves inside the Gestek
-- UI is invisible to both this dashboard and the bot — which is why the clinic has
-- been blocking time by creating a fake appointment. This is the honest version of
-- that hack: the block lives here, the grid paints it, and the bot skips it.
--
-- Shape is deliberately one row per half hour rather than an interval:
--   - the grid the caller clicks IS a half-hour ladder, so a click maps to exactly
--     one row and a drag to N inserts — no splitting or merging of ranges;
--   - unblocking is a delete of the rows the pointer crossed, with no interval
--     arithmetic that could half-erase somebody's block.
-- `start_min` is minutes from clinic-local midnight, the unit every other module
-- in features/agenda already speaks (see slots.ts).
--
-- Two directions, hence `kind`:
--   'block' — nothing is booked, and the clinic wants the time left alone.
--   'open'  — Gestek HAS an appointment there and the clinic wants the time
--             offered anyway (a cancellation not yet removed from Gestek, or one
--             of the fake appointments the clinic used to create to block time).
-- The direction is stored, never inferred from whether Gestek is busy right now:
-- Gestek changes under these rows, and a 'block' silently re-read as an 'open'
-- would hand a booked half hour back out.
--
-- Each direction is harmless against the state it does not describe: a 'block' on
-- a half hour that later gets a real appointment loses to the appointment, and an
-- 'open' on a half hour with nothing booked on it just says "offer this", which is
-- what Gestek was already saying. That is what keeps a stale row from doing damage.
--
-- Nothing here is a Gestek booking, and nothing here reaches Gestek. A real
-- appointment still comes from Gestek and is never written or deleted here — an
-- 'open' row does NOT cancel the appointment underneath it.

create table if not exists public.agenda_manual_blocks (
  date       date        not null,
  start_min  smallint    not null,
  created_at timestamptz not null default now(),
  -- Who ticked it, for the "quem bloqueou isso?" question. The CRM's logged-in
  -- user email; null for anything written outside a session.
  created_by text,
  -- The primary key is what limits a half hour to ONE decision: a cell cannot be
  -- blocked and opened at the same time.
  primary key (date, start_min)
);

-- Added after the table shipped block-only, so the file stays re-runnable on a
-- database that already has it. Plain text with no CHECK, like `stage` in 021:
-- the DB stays permissive, the app stays strict (features/agenda/blocks.ts).
alter table public.agenda_manual_blocks
  add column if not exists kind text not null default 'block';

-- Both readers ask the same question — "what did the clinic decide between these
-- two dates" — and the primary key's leading column already answers it.

grant select on public.agenda_manual_blocks to anon, authenticated, service_role, crm_readonly;
grant insert, update, delete on public.agenda_manual_blocks to service_role;
