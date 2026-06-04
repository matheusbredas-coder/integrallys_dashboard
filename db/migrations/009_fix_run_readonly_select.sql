-- Fix: SET ROLE is forbidden inside SECURITY DEFINER. Remove it.
-- Read-only protection is preserved by:
--   1. set local transaction_read_only = on  (blocks any DML/DDL at the txn level)
--   2. TypeScript sql-guard (layer 1, pre-execution)
-- The crm_readonly role is kept for future use (direct DB connections).
create or replace function public.run_readonly_select(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  set local transaction_read_only = on;
  set local statement_timeout = '5000ms';
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (%s) _q limit 1000) t',
    q
  ) into result;
  return result;
end $$;

revoke all on function public.run_readonly_select(text) from public;
grant execute on function public.run_readonly_select(text) to service_role;
