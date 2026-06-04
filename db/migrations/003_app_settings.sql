create table if not exists public.app_settings (
  key   text primary key,
  value numeric not null
);

insert into public.app_settings (key, value) values
  ('monthly_revenue_goal', 65000),
  ('monthly_new_patient_goal', 30),
  ('avg_ticket_goal', 280)
on conflict (key) do nothing;

grant select on public.app_settings to anon, authenticated, service_role;
grant insert, update on public.app_settings to service_role;
