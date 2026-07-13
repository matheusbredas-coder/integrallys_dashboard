import { describe, expect, test } from "vitest";
import { assignTrack, classifyProcedure, DEFAULT_TRACK_KEYWORDS } from "./classify";
import type { PatientSale } from "@/features/patients/types";

const kw = DEFAULT_TRACK_KEYWORDS;
const sale = (soldAt: string, procedimentos: string): PatientSale => ({ soldAt, procedimentos, total: 0, valorPago: 0 });

describe("classifyProcedure", () => {
  test("MONJAURO -> medidas", () => expect(classifyProcedure("MONJAURO 5,0 MG", kw)).toBe("medidas"));
  test("BOTOX -> rosto", () => expect(classifyProcedure("BOTOX POR ÁREA", kw)).toBe("rosto"));
  test("ENDOLASER -> medidas", () => expect(classifyProcedure("ENDOLASER", kw)).toBe("medidas"));
  test("LIPO DE PAPADA -> reserved (checked before medidas)", () =>
    expect(classifyProcedure("LIPO DE PAPADA", kw)).toBe("reserved"));
  test("PEIM -> reserved", () => expect(classifyProcedure("PEIM ( SECAGEM DE MICROVASOS)", kw)).toBe("reserved"));
  test("unknown -> null", () => expect(classifyProcedure("VITAMINAS (B12 OU D3)", kw)).toBeNull());
  test("overlapping keyword reserved > medidas priority", () => {
    const overlappingKw = {
      reserved: ["ALPHA"],
      medidas: ["ALPHA BETA"],
      rosto: [],
    };
    expect(classifyProcedure("ALPHA BETA COMPLEX", overlappingKw)).toBe("reserved");
  });
});

describe("assignTrack", () => {
  test("newest procedure wins: recent BOTOX over older MONJAURO -> rosto", () => {
    expect(assignTrack([sale("2024-01-01", "MONJAURO 5,0 MG (1)"), sale("2025-06-01", "BOTOX (1)")], kw)).toBe("rosto");
  });
  test("most recent is reserved -> reserved", () => {
    expect(assignTrack([sale("2025-06-01", "LIPO DE PAPADA (1)"), sale("2024-01-01", "BOTOX (1)")], kw)).toBe("reserved");
  });
  test("no keyword match anywhere -> fallback rosto", () => {
    expect(assignTrack([sale("2025-06-01", "VITAMINAS (B12 OU D3) (1)")], kw)).toBe("rosto");
  });
  test("empty sales -> fallback rosto", () => expect(assignTrack([], kw)).toBe("rosto"));
});
