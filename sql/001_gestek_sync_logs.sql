-- 001_gestek_sync_logs.sql
-- Persistent log of every backfill / sync run.
-- One row per execution of the gestek_core N8N workflow.

create table if not exists gestek_sync_logs (
  id           bigserial primary key,
  run_id       uuid not null,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  trigger      text not null check (trigger in ('backfill', 'webhook', 'cron')),
  mode         text not null check (mode in ('backfill', 'sync')),
  summary      jsonb,   -- { patients_updated, new_patients_inserted, unmatched_sales,
                        --   duplicate_name_warnings, monthly_windows_processed,
                        --   total_sales_aggregated }
  warnings     jsonb,   -- [ { "level": "warn", "message": "..." }, ... ]
  error        text     -- populated if the workflow failed
);

create index if not exists idx_gestek_sync_logs_started_at
  on gestek_sync_logs (started_at desc);

create index if not exists idx_gestek_sync_logs_run_id
  on gestek_sync_logs (run_id);
