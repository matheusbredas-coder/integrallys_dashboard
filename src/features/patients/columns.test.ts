import { describe, it, expect } from "vitest";
import { buildColumns, formatCell, sortValue } from "./columns";

const rows = [
  { id: "1", "Nome": "ANA", "Receita Total": "2500.00", "Numero de Vendas": "5", "Data do Cadastro": "03/06/26 14:30", segmento: "VIP" },
  { id: "2", "Nome": "BIA", "Receita Total": "", "Numero de Vendas": "0", "Data do Cadastro": "", segmento: "novo" },
];

describe("buildColumns", () => {
  const cols = buildColumns(rows);
  it("labels + types known columns, ordered (Nome first, id last)", () => {
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    expect(byKey["Nome"]).toEqual({ key: "Nome", label: "Nome", type: "text" });
    expect(byKey["Receita Total"].type).toBe("currency");
    expect(byKey["Numero de Vendas"].type).toBe("int");
    expect(byKey["Data do Cadastro"].type).toBe("date");
    expect(cols[0].key).toBe("Nome");
    expect(cols[cols.length - 1].key).toBe("id");
  });
  it("auto-includes unknown/new columns with humanized label", () => {
    const seg = buildColumns(rows).find((c) => c.key === "segmento");
    expect(seg).toEqual({ key: "segmento", label: "Segmento", type: "text" });
  });
});

describe("formatCell", () => {
  it("formats by type, blanks as dash", () => {
    expect(formatCell("2500.00", "currency")).toBe("R$ 2.500,00");
    expect(formatCell("5", "int")).toBe("5");
    expect(formatCell("03/06/26 14:30", "date")).toBe("03/06/2026");
    expect(formatCell("", "currency")).toBe("—");
    expect(formatCell("VIP", "text")).toBe("VIP");
  });
});

describe("sortValue", () => {
  it("returns comparable values per type", () => {
    expect(sortValue("2500.00", "currency")).toBe(2500);
    expect(sortValue("", "currency")).toBe(-Infinity);
    expect(sortValue("ANA", "text")).toBe("ana");
    expect(typeof sortValue("03/06/26 14:30", "date")).toBe("number");
  });
});
