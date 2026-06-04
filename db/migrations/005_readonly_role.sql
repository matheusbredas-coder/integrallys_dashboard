-- SELECT-only role used (via SET ROLE) to execute AI-generated SQL. No login needed.
do $$
begin
  if not exists (select from pg_roles where rolname = 'crm_readonly') then
    create role crm_readonly nologin;
  end if;
end $$;

grant usage on schema public to crm_readonly;
grant select on
  public.clientes_view,
  public.vendas_view,
  public.vendas_monthly,
  public.procedimentos_expanded
to crm_readonly;
-- Intentionally NOT granting base tables, app_settings, metric_snapshots, or auth.
