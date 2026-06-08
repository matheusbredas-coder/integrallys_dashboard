-- Expose gestek data_criacao as created_at on vendas_view.
--
-- Why: gestek_vendas.data (sold_at) is a calendar date — casting date -> timestamptz
-- yields local midnight, so it carries no time of day. The Overview hourly chart was
-- therefore dumping every sale of a day into the 00h bar. data_criacao is the real
-- wall-clock time the sale was registered in Gestek, so the hourly chart now buckets by
-- it. Daily/monthly granularity still keys off sold_at (the business sale date).
--
-- CREATE OR REPLACE is allowed here: created_at is appended after the existing trailing
-- column (profissional), so no column is reordered or removed.
create or replace view public.vendas_view as
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
  v.profissional,
  (v.data_criacao)::timestamptz                            as created_at
from public.gestek_vendas v
where v.status = 1;
