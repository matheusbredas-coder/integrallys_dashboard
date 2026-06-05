-- ─────────────────────────────────────────────────────────────────────────────
-- Cash actually received, bucketed by PAYMENT date (not sale date).
--
-- Why this exists: vendas_view.valor_pago / vendas_monthly was summing the amount
-- paid AT THE TIME OF SALE into the SALE's month. That answers "how much of this
-- month's SALES has been paid" — NOT "how much cash came in this month". For a
-- clinic with installment sales they differ, and only the payment-date basis
-- reconciles with Gestek's "Financeiro → Realizado".
--
-- Each gestek_vendas.pagamentos element is one realized payment: { data, valor, ... }.
-- Bucketed in the clinic's local time (America/Sao_Paulo) so "caixa do mês" lines up
-- with what the clinic sees in Gestek.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per realized payment (across completed sales).
create or replace view public.pagamentos_view as
select
  v.id                                                                            as venda_id,
  v.codigo,
  v.cliente_supabase_id,
  v.cliente                                                                       as cliente_nome,
  ((p->>'data')::timestamptz)                                                     as paid_at,
  (date_trunc('month', ((p->>'data')::timestamptz) at time zone 'America/Sao_Paulo'))::date as paid_month,
  ((p->>'valor')::numeric)                                                        as valor
from public.gestek_vendas v
cross join lateral jsonb_array_elements(coalesce(v.pagamentos, '[]'::jsonb)) p
where v.status = 1;

grant select on public.pagamentos_view to anon, authenticated, service_role;

-- Monthly cash-in (the number that reconciles with Gestek's "Realizado").
create or replace view public.cash_in_monthly as
select
  paid_month            as month,
  count(*)              as payments,
  sum(valor)::numeric   as cash_collected
from public.pagamentos_view
group by 1
order by 1;

grant select on public.cash_in_monthly to anon, authenticated, service_role;

-- Re-scope the sale-month rollup to pure billing (faturamento). The old
-- revenue_collected column mixed competences and was the source of the
-- discrepancy; cash now lives in cash_in_monthly above.
-- DROP (not CREATE OR REPLACE): removing the revenue_collected column changes the
-- view's shape, which CREATE OR REPLACE forbids ("cannot drop columns from view").
drop view if exists public.vendas_monthly;
create view public.vendas_monthly as
select
  (date_trunc('month', (data)::timestamptz))::date as month,
  count(*)                                          as sales,
  sum(coalesce(total, 0))::numeric                  as revenue_billed
from public.gestek_vendas
where status = 1
group by 1
order by 1;

grant select on public.vendas_monthly to anon, authenticated, service_role;
