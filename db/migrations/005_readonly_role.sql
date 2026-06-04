-- Dedicated SELECT-only login role used ONLY to execute AI-generated SQL (Plan 4).
-- Replace <STRONG_PASSWORD> before running; put the same value in the connection string.
do $$
begin
  if not exists (select from pg_roles where rolname = 'crm_readonly') then
    create role crm_readonly login password '<STRONG_PASSWORD>';
  end if;
end $$;

grant usage on schema public to crm_readonly;
grant select on public.clientes_view to crm_readonly;
grant select on public.procedimentos_expanded to crm_readonly;
-- Intentionally NOT granting on base tables or settings/snapshots.

alter role crm_readonly set statement_timeout = '5s';
alter role crm_readonly set default_transaction_read_only = on;
