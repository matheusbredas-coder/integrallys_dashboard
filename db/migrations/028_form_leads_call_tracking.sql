-- Call tracking for the kanban board on /marketing, worked by the person who
-- phones the form leads. See docs/marketing-board.md.
--
-- These columns are the CALLER'S OWN organization and are deliberately separate
-- from `stage`. `stage` is a three-writer funnel (the human dropdown, the bot via
-- POST /api/leads/form/stage, and the CSV import) and every write to it fires an
-- irreversible Meta CAPI conversion event. The board must never do either, so it
-- gets its own field rather than borrowing the funnel — which also means the
-- board can never break the bot's `stage='novo'` outbound gate.
--
-- `board_column` is named for what it is: a pointer at a column in one screen's
-- UI, not a funnel position. Values are null (= "A ligar") plus 'nao_atendeu',
-- 'retorno', 'qualificado', 'agendado', 'removido'. Like `stage` in 021, it stays
-- plain text with no CHECK: the DB stays permissive, the app stays strict
-- (see features/form-leads/types.ts).

alter table public.form_leads
  add column if not exists board_column   text,
  add column if not exists call_attempts  integer not null default 0,
  add column if not exists last_call_at   timestamptz,
  add column if not exists next_call_at   timestamptz;

-- The board's only ordering question is "who do I call next", and the terminal
-- columns never carry a due date — so the index is partial.
create index if not exists form_leads_next_call_idx
  on public.form_leads (next_call_at) where next_call_at is not null;
