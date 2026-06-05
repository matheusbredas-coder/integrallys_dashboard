import type { GestekAgenda, GestekAgendaRow } from "./types";

// Treat a missing `pendente` as pending (true) — safest default; only pendente === false counts as realized.
export function mapAgendaToRow(a: GestekAgenda): GestekAgendaRow {
  return {
    id: a.id,
    data_inicio: a.dataAgendamentoInicio ?? "",
    pendente: a.pendente ?? true,
    cliente_nome: a.clienteNome ?? null,
    cliente_telefone: a.clienteTelefone ?? null,
    profissional_id: a.profissional?.id ?? null,
    profissional_nome: a.profissional?.nome ?? null,
    sala_nome: a.salaAtendimento?.nome ?? null,
    procedimentos: a.procedimentos ?? [],
  };
}
