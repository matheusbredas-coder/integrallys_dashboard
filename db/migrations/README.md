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
16. `016_bot_leads.sql` — Lead Qualifier Bot tables (`leads`, `lead_messages`), `leads_view`, grants, and public `bot-media` storage bucket.
17. `018_reactivation_campaigns.sql` — campaigns table for reactivation campaign storage and bot_leads reactivation columns (track, last_template_at).

After applying 001/002, sanity-check:
```sql
select count(*) n, sum(receita_total) revenue, sum(numero_vendas) sales from public.clientes_view;
select procedure_name, sum(qty) total from public.procedimentos_expanded group by 1 order by 2 desc limit 5;
```
