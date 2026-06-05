import { describe, it, expect } from "vitest";
import { normalizeName, parseLocalDateTimeToUtc, utcMinuteKey, matchKey, mapStatus } from "./parse";

describe("normalizeName", () => {
  it("strips accents, collapses spaces, uppercases", () => {
    expect(normalizeName("Fátima  Cláudio")).toBe("FATIMA CLAUDIO");
    expect(normalizeName(" tati thomazini ")).toBe("TATI THOMAZINI");
  });
});

describe("parseLocalDateTimeToUtc", () => {
  it("converts local DD/MM/YY HH:MM to UTC (+3h, America/Sao_Paulo)", () => {
    expect(parseLocalDateTimeToUtc("25/05/26 12:00")?.toISOString()).toBe("2026-05-25T15:00:00.000Z");
    expect(parseLocalDateTimeToUtc("25/05/26 20:00")?.toISOString()).toBe("2026-05-25T23:00:00.000Z");
  });
  it("rolls into the next UTC day when local + 3h crosses midnight", () => {
    expect(parseLocalDateTimeToUtc("25/05/26 22:30")?.toISOString()).toBe("2026-05-26T01:30:00.000Z");
  });
  it("returns null for junk", () => {
    expect(parseLocalDateTimeToUtc("")).toBeNull();
    expect(parseLocalDateTimeToUtc("Agendado")).toBeNull();
  });
});

describe("utcMinuteKey / matchKey", () => {
  it("keys to the minute in UTC", () => {
    expect(utcMinuteKey(new Date("2026-05-25T15:00:30.000Z"))).toBe("2026-05-25T15:00");
  });
  it("matchKey from a stored booking equals one from the report row", () => {
    const stored = matchKey("LEELSON LEMOS POLEZI", new Date("2026-05-25T15:30:00+00:00"));
    const report = matchKey("Leelson Lemos Polezi", parseLocalDateTimeToUtc("25/05/26 12:30")!);
    expect(report).toBe(stored);
  });
});

describe("mapStatus", () => {
  it("maps Finalizado -> realizado", () => {
    expect(mapStatus("Finalizado")).toEqual({ kind: "apply", status: "realizado" });
  });
  it("maps 'Finalizado Com Falta' -> falta (falta wins over finaliz)", () => {
    expect(mapStatus("Finalizado Com Falta")).toEqual({ kind: "apply", status: "falta" });
  });
  it("maps cancellation variants -> cancelado", () => {
    expect(mapStatus("Cancelado")).toEqual({ kind: "apply", status: "cancelado" });
    expect(mapStatus("Cancelado pelo cliente")).toEqual({ kind: "apply", status: "cancelado" });
  });
  it("maps no-show phrasing -> falta", () => {
    expect(mapStatus("Não compareceu")).toEqual({ kind: "apply", status: "falta" });
  });
  it("skips not-yet-resolved states", () => {
    expect(mapStatus("Agendado")).toEqual({ kind: "skip" });
    expect(mapStatus("Confirmado")).toEqual({ kind: "skip" });
    expect(mapStatus("")).toEqual({ kind: "skip" });
  });
  it("flags unrecognized labels as unknown", () => {
    expect(mapStatus("Em atendimento agora mesmo zzz")).toEqual({ kind: "unknown" });
  });
});
