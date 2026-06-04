-- 002_bulk_update_patient_metrics.sql
--
-- Bulk-update the 5 metric columns on public."Clientes" in a single RPC call.
--
-- INPUT (jsonb array):
--   [
--     {
--       "id":               "<gestek_client_id>",
--       "procedimentos":    "Botox (3), Limpeza (2)",
--       "numero_de_vendas": "5",
--       "receita_total":    "2500.00",
--       "descontos":        "120.50",
--       "ticket_medio":     "500.00"
--     },
--     ...
--   ]
--
-- All numeric fields arrive as strings because the target columns are TEXT.
-- The RPC writes them verbatim — formatting/parsing is done in N8N.
--
-- RETURNS: number of rows actually updated.

create or replace function public.bulk_update_patient_metrics(payload jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  updated_count int := 0;
begin
  for item in select * from jsonb_array_elements(payload)
  loop
    update public."Clientes"
       set "Procedimentos"    = item ->> 'procedimentos',
           "Numero de Vendas" = item ->> 'numero_de_vendas',
           "Receita Total"    = item ->> 'receita_total',
           "Descontos"        = item ->> 'descontos',
           "Ticket Medio"     = item ->> 'ticket_medio'
     where id = item ->> 'id';

    if found then
      updated_count := updated_count + 1;
    end if;
  end loop;

  return updated_count;
end;
$$;

grant execute on function public.bulk_update_patient_metrics(jsonb) to service_role;
