-- Compute patient metrics live from gestek_vendas (status=1) instead of the
-- stored "Numero de Vendas"/"Receita Total"/... text columns on Clientes.
-- Same output columns/types as before, so the dashboard is unaffected.
create or replace view clientes_view as
select
  c.id,
  c."Nome"               as nome,
  c."Telefone Principal" as telefone,
  c."Email Principal"    as email,
  c."Origem"             as origem,
  c."Procedimentos"      as procedimentos_raw,
  coalesce(v.numero_vendas, 0)                          as numero_vendas,
  coalesce(v.receita_total, 0)::numeric                 as receita_total,
  coalesce(v.descontos, 0)::numeric                     as descontos,
  case when coalesce(v.numero_vendas,0) > 0
       then (v.receita_total / v.numero_vendas)::numeric
       else 0::numeric end                              as ticket_medio,
  c."Data do Cadastro"                                  as cadastro_raw,
  to_timestamp(nullif(btrim(c."Data do Cadastro"), ''), 'DD/MM/YY HH24:MI') as cadastro_at
from "Clientes" c
left join (
  select cliente_supabase_id,
         count(*)        as numero_vendas,
         sum(total)      as receita_total,
         sum(desconto)   as descontos
  from gestek_vendas
  where status = 1 and cliente_supabase_id is not null
  group by cliente_supabase_id
) v on v.cliente_supabase_id = c.id;
