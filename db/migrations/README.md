# Database migrations

Apply these in order in the Supabase SQL editor (Dashboard → SQL Editor), or via psql against the project's direct connection string.

1. `001_clientes_view.sql` — typed/normalized view over `Clientes`
2. `002_procedimentos_expanded.sql` — unnested (patient, procedure, qty) view
3. `003_app_settings.sql` — gauge target settings + seed defaults
4. `004_metric_snapshots.sql` — monthly metric history (populated going forward)
5. `005_readonly_role.sql` — SELECT-only `crm_readonly` role for the AI chat. **Replace `<STRONG_PASSWORD>`** with a strong password and use the same value in `SUPABASE_READONLY_CONNECTION_STRING`.

After applying 001/002, sanity-check:
```sql
select count(*) n, sum(receita_total) revenue, sum(numero_vendas) sales from public.clientes_view;
select procedure_name, sum(qty) total from public.procedimentos_expanded group by 1 order by 2 desc limit 5;
```
