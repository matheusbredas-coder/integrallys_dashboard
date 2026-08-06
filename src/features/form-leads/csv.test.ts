import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("maps each data row to a header -> cell object", () => {
    const text = "id,nome\nl:1,Ana\nl:2,Bea\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Silva, Ana"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: "Silva, Ana" }]);
  });

  it("keeps a newline inside a quoted field", () => {
    const text = 'id,nota\nl:1,"linha um\nlinha dois"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nota: "linha um\nlinha dois" }]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Maria ""Mah"" Silva"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: 'Maria "Mah" Silva' }]);
  });

  it("handles CRLF line endings", () => {
    const text = "id,nome\r\nl:1,Ana\r\nl:2,Bea\r\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("ignores a blank trailing line and works with no closing newline", () => {
    expect(parseCsv("id,nome\nl:1,Ana\n\n")).toEqual([{ id: "l:1", nome: "Ana" }]);
    expect(parseCsv("id,nome\nl:1,Ana")).toEqual([{ id: "l:1", nome: "Ana" }]);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCsv("id,nome\n")).toEqual([]);
  });
});

import { parseCsvLeads, isInvalidLead, classifyCsvLeads } from "./csv";

describe("parseCsvLeads", () => {
  it("maps each row through mapSheetFields and numbers rows starting at 2 (header is row 1)", () => {
    const text = "id,nome_completo,email,telefone\nl:1,Ana,ana@x.com,+5511999999999\n";
    expect(parseCsvLeads(text)).toEqual([
      {
        rowNumber: 2,
        lead: {
          external_id: "l:1",
          name: "Ana",
          phone: "5511999999999",
          email: "ana@x.com",
          campaign: null,
          form_name: null,
          submitted_at: null,
          raw: { id: "l:1", nome_completo: "Ana", email: "ana@x.com", telefone: "+5511999999999" },
        },
      },
    ]);
  });
});

describe("isInvalidLead", () => {
  const base = { external_id: null, campaign: null, form_name: null, submitted_at: null, raw: {} };

  it("is true only when name, phone and email are all null", () => {
    expect(isInvalidLead({ ...base, name: null, phone: null, email: null })).toBe(true);
    expect(isInvalidLead({ ...base, name: "Ana", phone: null, email: null })).toBe(false);
  });
});

describe("classifyCsvLeads", () => {
  it("marks the first occurrence of an id new and later ones in the same file duplicate", () => {
    const rows = parseCsvLeads("id,nome_completo\nl:1,Ana\nl:1,Ana Repetida\n");
    expect(classifyCsvLeads(rows, new Set()).map((r) => r.status)).toEqual(["new", "duplicate"]);
  });

  it("marks an id already in the database as duplicate", () => {
    const rows = parseCsvLeads("id,nome_completo\nl:1,Ana\n");
    expect(classifyCsvLeads(rows, new Set(["l:1"])).map((r) => r.status)).toEqual(["duplicate"]);
  });

  it("marks a row with no identity fields invalid, even with other columns present", () => {
    const rows = parseCsvLeads("id,nome_completo,campanha\nl:1,,Campanha X\n");
    expect(classifyCsvLeads(rows, new Set()).map((r) => r.status)).toEqual(["invalid"]);
  });
});
