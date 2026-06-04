create table if not exists public.metric_snapshots (
  id            bigint generated always as identity primary key,
  captured_at   timestamptz not null default now(),
  period_month  date not null,                 -- first day of the snapshot month
  total_revenue numeric,
  total_patients int,
  total_sales   int,
  avg_ticket    numeric,
  unique (period_month)
);

grant select on public.metric_snapshots to anon, authenticated, service_role;
grant insert, update on public.metric_snapshots to service_role;
