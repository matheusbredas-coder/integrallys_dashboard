-- Normalized, typed view over the TEXT-column Clientes table.
create or replace view public.clientes_view as
select
  c.id,
  c."Nome"               as nome,
  c."Telefone Principal" as telefone,
  c."Email Principal"    as email,
  c."Origem"             as origem,
  c."Procedimentos"      as procedimentos_raw,
  nullif(trim(c."Numero de Vendas"), '')::int        as numero_vendas,
  nullif(trim(c."Receita Total"), '')::numeric       as receita_total,
  nullif(trim(c."Descontos"), '')::numeric           as descontos,
  nullif(trim(c."Ticket Medio"), '')::numeric        as ticket_medio,
  c."Data do Cadastro"   as cadastro_raw,
  to_timestamp(nullif(trim(c."Data do Cadastro"), ''), 'DD/MM/YY HH24:MI') as cadastro_at
from public."Clientes" c;
-- Note: gestek_id is intentionally omitted — that column only exists after running
-- backfill_gestek_id.sql. To include it later, append `, c.gestek_id` to the select.

grant select on public.clientes_view to anon, authenticated, service_role;
