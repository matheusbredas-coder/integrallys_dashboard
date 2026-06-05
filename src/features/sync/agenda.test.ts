import { describe, it, expect } from "vitest";
import { mapAgendaToRow } from "./agenda";
import type { GestekAgenda } from "./types";

describe("mapAgendaToRow", () => {
  it("maps Gestek fields to a gestek_agenda row", () => {
    const a: GestekAgenda = {
      id: "abc123",
      dataAgendamentoInicio: "2026-04-02T15:00:00Z",
      pendente: false,
      clienteNome: "SANDRA REGINA",
      clienteTelefone: "27999999999",
      profissional: { id: "p1", nome: "DR PEDRO" },
      salaAtendimento: { id: "s1", nome: "Sala Principal" },
      procedimentos: [{ id: "x", nome: "MONJAURO 2,5 MG", duracaoMinutos: 10, valor: 0 }],
    };
    const row = mapAgendaToRow(a);
    expect(row).toEqual({
      id: "abc123",
      data_inicio: "2026-04-02T15:00:00Z",
      pendente: false,
      cliente_nome: "SANDRA REGINA",
      cliente_telefone: "27999999999",
      profissional_id: "p1",
      profissional_nome: "DR PEDRO",
      sala_nome: "Sala Principal",
      procedimentos: [{ id: "x", nome: "MONJAURO 2,5 MG", duracaoMinutos: 10, valor: 0 }],
    });
  });

  it("defaults pendente to true and procedimentos to [] when absent", () => {
    const row = mapAgendaToRow({ id: "x", dataAgendamentoInicio: "2026-01-01T00:00:00Z" });
    expect(row.pendente).toBe(true);
    expect(row.procedimentos).toEqual([]);
    expect(row.cliente_nome).toBeNull();
    expect(row.profissional_id).toBeNull();
    expect(row.sala_nome).toBeNull();
  });
});
