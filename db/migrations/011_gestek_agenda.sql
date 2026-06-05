-- Realized/scheduled consultations pulled from Gestek /api/agenda.
-- "Atendimento realizado" = pendente = false (verified against the live calendar).
create table if not exists public.gestek_agenda (
  id                text primary key,       -- Gestek agendamento id (ObjectId string)
  data_inicio       timestamptz not null,   -- dataAgendamentoInicio (UTC)
  pendente          boolean not null,
  cliente_nome      text,
  cliente_telefone  text,
  profissional_id   text,
  profissional_nome text,
  sala_nome         text,
  procedimentos     jsonb,                  -- [{id,nome,duracaoMinutos,valor}]
  synced_at         timestamptz default now()
);
create index if not exists gestek_agenda_data_inicio_idx on public.gestek_agenda (data_inicio);
create index if not exists gestek_agenda_pendente_idx on public.gestek_agenda (pendente);

create or replace view public.agenda_view as
select
  a.id,
  a.data_inicio                              as appointment_at,
  (date_trunc('month', a.data_inicio))::date as appointment_month,
  a.pendente,
  (not a.pendente)                           as realizada,
  a.cliente_nome,
  a.profissional_nome,
  a.procedimentos
from public.gestek_agenda a;

grant select on public.agenda_view to anon, authenticated, service_role;
grant select on public.agenda_view to crm_readonly;  -- AI chat read-only role (migration 005)
