-- One row per (patient, procedure, qty), parsed from "Botox (3), Limpeza (2)".
create or replace view public.procedimentos_expanded as
select
  c.id,
  trim(m[1]) as procedure_name,
  (m[2])::int as qty
from public."Clientes" c
cross join lateral
  regexp_matches(coalesce(c."Procedimentos", ''), '([^,()]+?)\s*\((\d+)\)', 'g') as m;

grant select on public.procedimentos_expanded to anon, authenticated, service_role;
