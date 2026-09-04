# Database migrations

Apply these in order in the Supabase SQL editor (Dashboard → SQL Editor), or via psql against the project's direct connection string.

1. `001_clientes_view.sql` — typed/normalized view over `Clientes`
2. `002_procedimentos_expanded.sql` — unnested (patient, procedure, qty) view
3. `003_app_settings.sql` — gauge target settings + seed defaults
4. `004_metric_snapshots.sql` — monthly metric history (populated going forward)
5. `005_readonly_role.sql` — SELECT-only `crm_readonly` role for the AI chat. **Replace `<STRONG_PASSWORD>`** with a strong password and use the same value in `SUPABASE_READONLY_CONNECTION_STRING`.

6. `006_vendas_view.sql` — sales view with date/amount projections
7. `007_vendas_monthly.sql` — monthly sales aggregation
8. `008_run_readonly_select.sql` — RPC for read-only queries
9. `009_fix_run_readonly_select.sql` — fix run_readonly_select RPC
10. `010_clientes_view_computed_metrics.sql` — add metrics to clientes_view
11. `011_gestek_agenda.sql` — gestek_agenda table + agenda_view
12. `012_cash_in.sql` — cash in tracking tables
13. `013_agenda_attendance.sql` — agenda attendance tracking
14. `014_vendas_view_discount.sql` — add discount field to vendas_view
15. `015_vendas_view_created_at.sql` — add created_at to vendas_view
16. `016_bot_leads.sql` — Lead Qualifier Bot tables (`bot_leads`, `bot_lead_messages`, named with a `bot_` prefix to avoid colliding with a pre-existing unrelated `public.leads` table), `bot_leads_view`, grants, and public `bot-media` storage bucket.
17. `017_bot_leads_sent_images.sql` — adds `bot_leads.sent_image_urls` (per-lead pitch-image dedup).
18. `018_reactivation_campaigns.sql` — campaigns table for reactivation campaign storage and bot_leads reactivation columns (track, last_template_at). **Depends on 016 being applied with its current `bot_leads` naming** (016 and 017 are both still uncommitted/unapplied as of this entry).
19. `019_bot_appointment_confirmations.sql` — `bot_appointment_confirmations` table (day-before WhatsApp confirmation audit/idempotency, bot-owned), `bot_leads` columns `pending_confirmation_agenda_id`/`origin`, and widens `agenda_attendance`'s source check to allow `'whatsapp'`.
20. `020_wa_links.sql` — tracked WhatsApp click-to-chat links (`/r/<slug>`) and their click counts.
21. `021_form_leads.sql` — `form_leads` table for Meta Instant Form leads, ingested by the n8n Gmail workflow via `/api/leads/form`. See `docs/gmail-form-leads.md`.
22. `022_form_leads_protocolo.sql` — adds `form_leads.protocolo` (treatment programme), `not null default 'emagrecimento'` so existing rows backfill in place. Shown as a column on `/marketing`.
23. `023_capi_events.sql` — `capi_events` outbox for Meta Conversions API events fired when a form lead reaches a high-intent stage. **Depends on 021.** The `payload` column holds the already-hashed request body, never plaintext PII. See `docs/meta-capi.md`.
24. `024_bot_appointment_reminders.sql` — adds `bot_appointment_confirmations.reminder_sent_at`, the idempotency guard for the bot's in-process 9am morning-of reminder job. **Depends on 019.**
25. `025_bot_bookings.sql` — `bot_bookings` table (form-lead-to-booked-evaluation flow with a R$50 PIX deposit; the CRM's only write is the approve/reject decision), `bot_leads` columns `pending_booking_id`/`form_lead_id`, and the private `bot-comprovantes` storage bucket for receipt images.
26. `026_bot_leads_script_state.sql` — adds `bot_leads.script_id`/`script_step_id`, the pointer used by
    the Lead Qualifier Bot's pinned outbound scripts (e.g. the form-lead opening). **Must be applied
    before deploying** — `bot_leads` update calls carrying these fields fail without it, the same
    Supabase-does-not-auto-migrate trap every earlier `bot_leads` column addition hit.
27. `027_bot_leads_promised_followup.sql` — adds `bot_leads.promised_follow_up_at`, the day a lead named
    herself in the "deixa eu pensar" objection flow (`registrar_retorno_combinado`). **Must be applied
    before deploying the follow-up sequence scheduler** — same Supabase-does-not-auto-migrate trap as
    every earlier `bot_leads` column addition.
28. `028_form_leads_call_tracking.sql` — adds `form_leads.board_column` / `call_attempts` /
    `last_call_at` / `next_call_at`, the caller's kanban board on `/marketing`. **Must be applied
    before deploying the board** — the server action writes these columns and fails without them.
    Deliberately separate from `stage`: the board never touches the funnel and never fires a Meta
    CAPI event. **Depends on 021.** See `docs/marketing-board.md`.

29. `029_agenda_manual_blocks.sql` — `agenda_manual_blocks`, the half hours the clinic decides BY HAND
    from the "Agenda da semana" grid on `/marketing`. `kind` carries the direction: `'block'` closes a
    free half hour, `'open'` offers one Gestek shows as booked (a cancellation nobody removed). **Must
    be applied before deploying the editable agenda** — the server action writes this table and fails
    without it, and the Lead Qualifier Bot reads it to decide what it may offer
    (`src/booking/blocks.ts`). Both sides degrade to "the clinic decided nothing" if the table is
    missing, so applying it late is safe but useless. The file is re-runnable: the `kind` column is
    added with `alter ... if not exists`, so a database that already has the block-only version just
    gains the column. See `docs/agenda-blocks.md`.

After applying 001/002, sanity-check:
```sql
select count(*) n, sum(receita_total) revenue, sum(numero_vendas) sales from public.clientes_view;
select procedure_name, sum(qty) total from public.procedimentos_expanded group by 1 order by 2 desc limit 5;
```
