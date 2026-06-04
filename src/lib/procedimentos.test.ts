import { describe, it, expect } from "vitest";
import { parseProcedimentos, topProcedures } from "./procedimentos";

describe("parseProcedimentos", () => {
  it("parses simple items", () => {
    expect(parseProcedimentos("BOTOX (2), MICROAGULHAMENTO (1)")).toEqual([
      { name: "BOTOX", qty: 2 },
      { name: "MICROAGULHAMENTO", qty: 1 },
    ]);
  });
  it("keeps commas inside names (dosages)", () => {
    expect(parseProcedimentos("MONJAURO 2,5 MG (3)")).toEqual([{ name: "MONJAURO 2,5 MG", qty: 3 }]);
  });
  it("keeps parentheses inside names", () => {
    expect(parseProcedimentos("MONJAURO 2,5 MG (PROMOCIONAL) (1)")).toEqual([
      { name: "MONJAURO 2,5 MG (PROMOCIONAL)", qty: 1 },
    ]);
  });
  it("handles null/empty", () => {
    expect(parseProcedimentos(null)).toEqual([]);
    expect(parseProcedimentos("")).toEqual([]);
  });
});

describe("topProcedures", () => {
  it("sums quantities across rows and ranks", () => {
    const rows = ["BOTOX (2)", "BOTOX (1), MONJAURO 5,0 MG (4)"];
    expect(topProcedures(rows, 2)).toEqual([
      { name: "MONJAURO 5,0 MG", qty: 4 },
      { name: "BOTOX", qty: 3 },
    ]);
  });
});
