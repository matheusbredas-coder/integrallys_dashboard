-- ─────────────────────────────────────────────────────────────────────────────
-- Attendance outcomes (realizado / cancelado / falta) layered on top of the
-- sync-owned agenda.
--
-- Why this exists: Gestek's public /agenda only exposes `pendente` (boolean), which
-- can't tell a realized appointment apart from a cancellation or no-show, and every
-- sync overwrites it. So the clinic's actual outcomes live here, in a table the sync
-- never touches, and agenda_view computes an EFFECTIVE status:
--   override present            -> the override
--   past booking, no override   -> 'realizado'  (assume completed)
--   future booking, no override -> 'agendado'
--
-- Outcomes are loaded from the Gestek "Relatório de Atendimentos" xlsx, imported on
-- the Configurações page (source = 'xlsx'). 'chat' is reserved for a future path.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.agenda_attendance (
  agenda_id  text primary key references public.gestek_agenda(id) on delete cascade,
  status     text not null check (status in ('realizado','cancelado','falta')),
  source     text not null check (source in ('chat','xlsx')),
  note       text,
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.agenda_attendance to service_role;

-- agenda_view now exposes the EFFECTIVE status (replacing the old pendente/realizada cols).
drop view if exists public.agenda_view;

create view public.agenda_view as
select
  a.id,
  a.data_inicio                              as appointment_at,
  (date_trunc('month', a.data_inicio))::date as appointment_month,
  a.cliente_nome,
  a.profissional_nome,
  a.procedimentos,
  coalesce(
    att.status,
    case when a.data_inicio < now() then 'realizado'
         else 'agendado' end
  ) as status,
  att.source as status_source
from public.gestek_agenda a
left join public.agenda_attendance att on att.agenda_id = a.id;

grant select on public.agenda_view to anon, authenticated, service_role;
grant select on public.agenda_view to crm_readonly;  -- AI chat read-only role (migration 005)
