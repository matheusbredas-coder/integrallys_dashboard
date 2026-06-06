-- Re-create vendas_view to also expose valor_desconto, the canonical BRL discount.
--
-- Why: gestek_vendas.desconto is a PERCENTAGE for tipo_desconto = 0 sales, so it
-- cannot be summed across sales. valor_desconto is always the resolved discount in
-- reais (it equals subtotal - total), so it is the field the Overview "Descontos"
-- gauge sums. Migration 006 exposed only `desconto`; this adds `valor_desconto`.
--
-- Must DROP (not CREATE OR REPLACE): valor_desconto is inserted before `profissional`,
-- which reorders the view's columns and CREATE OR REPLACE forbids that. Dropping also
-- drops grants, so every grant is re-issued below (including crm_readonly from 005).
drop view if exists public.vendas_view;

create view public.vendas_view as
select
  v.id,
  v.codigo,
  (v.data)::timestamptz                                    as sold_at,
  (date_trunc('month', (v.data)::timestamptz))::date       as sold_month,
  v.cliente_supabase_id,
  v.cliente                                                as cliente_nome,
  v.status,
  v.procedimentos,
  coalesce(v.subtotal, 0)::numeric                         as subtotal,
  coalesce(v.total, 0)::numeric                            as total,
  coalesce(v.valor_pago, 0)::numeric                       as valor_pago,
  coalesce(v.desconto, 0)::numeric                         as desconto,
  coalesce(v.valor_desconto, 0)::numeric                   as valor_desconto,
  v.profissional
from public.gestek_vendas v
where v.status = 1;

grant select on public.vendas_view to anon, authenticated, service_role;
grant select on public.vendas_view to crm_readonly;  -- AI chat read-only role (migration 005)
