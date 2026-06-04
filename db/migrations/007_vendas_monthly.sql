-- Monthly rollup for charts and the future AI.
create or replace view public.vendas_monthly as
select
  (date_trunc('month', (data)::timestamptz))::date as month,
  count(*)                                          as sales,
  sum(coalesce(total, 0))::numeric                  as revenue_billed,
  sum(coalesce(valor_pago, 0))::numeric             as revenue_collected
from public.gestek_vendas
where status = 1
group by 1
order by 1;

grant select on public.vendas_monthly to anon, authenticated, service_role;
