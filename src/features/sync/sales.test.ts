import { describe, it, expect } from "vitest";
import { buildProcedimentos, mapVendaToRow } from "./sales";
import type { GestekVenda } from "./types";

describe("buildProcedimentos", () => {
  it("formats items as 'Nome (qty)', sorted by qty desc", () => {
    expect(buildProcedimentos([{ nome: "BOTOX", quantidade: 1 }, { nome: "PREENCHIMENTO", quantidade: 3 }]))
      .toBe("PREENCHIMENTO (3), BOTOX (1)");
  });
  it("returns null for empty", () => {
    expect(buildProcedimentos([])).toBeNull();
  });
});

describe("mapVendaToRow", () => {
  const venda: GestekVenda = {
    id: "v1", codigo: 9, data: "2025-08-01T17:00:00Z", cliente: "ANA", clienteId: "aaa111",
    status: 1, subtotal: 100.005, desconto: 10, valorDesconto: 0, tipoDesconto: 1, total: 90,
    valorPago: 90, valorTaxasCartao: 2, profissional: "DR", observacoes: "x",
    itens: [{ nome: "BOTOX", quantidade: 2 }], pagamentos: [{ forma: "pix" }],
    dataCriacao: "2025-08-01T10:00:00Z", dataUltimaAlteracao: "0001-01-01T00:00:00Z",
  };
  it("maps fields + resolves cliente_supabase_id via the gestek_id map", () => {
    const row = mapVendaToRow(venda, { aaa111: "12" });
    expect(row.id).toBe("v1");
    expect(row.cliente_gestek_id).toBe("aaa111");
    expect(row.cliente_supabase_id).toBe("12");
    expect(row.subtotal).toBe(100.01); // rounded to 2dp
    expect(row.procedimentos).toBe("BOTOX (2)");
    expect(row.data_ultima_alteracao).toBeNull(); // 0001 sentinel -> null
    expect(row.data_criacao).toBe("2025-08-01T10:00:00Z");
  });
  it("falls back to name map when gestek_id not matched", () => {
    const row = mapVendaToRow(venda, {}, { ana: "55" });
    expect(row.cliente_supabase_id).toBe("55");
  });
  it("sets cliente_supabase_id null when unresolved", () => {
    const row = mapVendaToRow(venda, {}, {});
    expect(row.cliente_supabase_id).toBeNull();
  });
});
