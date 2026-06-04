-- Executes one AI-generated SELECT as the read-only role: read-only txn, 5s timeout,
-- 1000-row cap, returns a JSON array. Validation also happens in TypeScript first.
create or replace function public.run_readonly_select(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  set local role crm_readonly;
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
