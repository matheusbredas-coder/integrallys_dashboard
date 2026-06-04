-- One row per (patient, procedure, qty).
-- Real Procedimentos format: items separated by ", ", but names can contain commas
-- (e.g. "MONJAURO 2,5 MG") and parentheses (e.g. "(PROMOCIONAL)", "( SECAGEM ...)").
-- The count is always the TRAILING "(N)" of each item.
-- Strategy: mark each trailing count with a sentinel (§), split on it, then take the
-- greedy "name + last (N)" from each chunk.
create or replace view public.procedimentos_expanded as
with chunks as (
  select
    c.id,
    trim(both E' \t,' from chunk) as item
  from public."Clientes" c
  cross join lateral regexp_split_to_table(
    regexp_replace(coalesce(c."Procedimentos", ''), '\((\d+)\)(\s*,\s*|\s*$)', '(\1)§', 'g'),
    '§'
  ) as chunk
)
select
  ch.id,
  trim(x.m[1]) as procedure_name,
  (x.m[2])::int as qty
from chunks ch
cross join lateral (select regexp_match(ch.item, '^(.*)\((\d+)\)\s*$') as m) x
where x.m is not null;

grant select on public.procedimentos_expanded to anon, authenticated, service_role;
