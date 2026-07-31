import { describe, it, expect } from "vitest";
import { mapSheetFields, normalizeHeader, parseSubmittedAt } from "./mapping";

// The column set Meta's Lead Ads -> Sheets integration produces for a standard form.
const metaRow = {
  id: "l_10223344",
  created_time: "2026-07-31T14:23:05+0000",
  campaign_name: "Harmonização - Julho",
  form_name: "Avaliação gratuita",
  full_name: "Ana Souza",
  phone_number: "+55 (41) 99999-8888",
  email: "Ana@Example.COM",
};

describe("normalizeHeader", () => {
  it("collapses case, accents and punctuation to one form", () => {
    expect(normalizeHeader("Nome Completo")).toBe("nome completo");
    expect(normalizeHeader("nome_completo")).toBe("nome completo");
    expect(normalizeHeader("NOME-COMPLETO")).toBe("nome completo");
    expect(normalizeHeader("Formulário")).toBe("formulario");
    expect(normalizeHeader("  E-mail  ")).toBe("e mail");
  });

  it("is empty for headers with no alphanumerics", () => {
    expect(normalizeHeader("—")).toBe("");
    expect(normalizeHeader("")).toBe("");
  });
});

describe("parseSubmittedAt", () => {
  it("parses the ISO-8601 Meta writes", () => {
    expect(parseSubmittedAt("2026-07-31T14:23:05+0000")).toBe("2026-07-31T14:23:05.000Z");
  });

  it("parses a pt-BR date that Sheets localized", () => {
    // Constructed as local time, so compare against a locally-built Date.
    const expected = new Date(2026, 6, 31, 14, 23, 0).toISOString();
    expect(parseSubmittedAt("31/07/2026 14:23")).toBe(expected);
  });

  it("parses a pt-BR date with no time component", () => {
    const expected = new Date(2026, 6, 31, 0, 0, 0).toISOString();
    expect(parseSubmittedAt("31/07/2026")).toBe(expected);
  });

  it("returns null for blank or unparseable values", () => {
    expect(parseSubmittedAt(null)).toBeNull();
    expect(parseSubmittedAt("")).toBeNull();
    expect(parseSubmittedAt("ontem à tarde")).toBeNull();
  });
});

describe("mapSheetFields", () => {
  it("maps Meta's standard columns", () => {
    const m = mapSheetFields(metaRow);
    expect(m.external_id).toBe("l_10223344");
    expect(m.name).toBe("Ana Souza");
    expect(m.campaign).toBe("Harmonização - Julho");
    expect(m.form_name).toBe("Avaliação gratuita");
    expect(m.submitted_at).toBe("2026-07-31T14:23:05.000Z");
  });

  it("normalizes the phone to digits only", () => {
    expect(mapSheetFields(metaRow).phone).toBe("5541999998888");
  });

  it("lowercases the email", () => {
    expect(mapSheetFields(metaRow).email).toBe("ana@example.com");
  });

  it("maps pt-BR headers just as well", () => {
    const m = mapSheetFields({
      "Nome completo": "João Lima",
      Telefone: "41988887777",
      "E-mail": "joao@example.com",
      Campanha: "Botox Agosto",
      Formulário: "Lead Botox",
    });
    expect(m.name).toBe("João Lima");
    expect(m.phone).toBe("41988887777");
    expect(m.email).toBe("joao@example.com");
    expect(m.campaign).toBe("Botox Agosto");
    expect(m.form_name).toBe("Lead Botox");
  });

  it("keeps every column in raw, mapped or not", () => {
    const m = mapSheetFields({ ...metaRow, "Qual seu principal incômodo?": "rugas na testa" });
    expect(m.raw["Qual seu principal incômodo?"]).toBe("rugas na testa");
    expect(m.raw.full_name).toBe("Ana Souza"); // mapped columns are kept too
    expect(Object.keys(m.raw)).toHaveLength(8);
  });

  it("does not mistake campaign_id for campaign_name", () => {
    const m = mapSheetFields({ campaign_id: "120000", campaign_name: "Julho" });
    expect(m.campaign).toBe("Julho");
  });

  it("does not mistake form_id for form_name", () => {
    const m = mapSheetFields({ form_id: "998877", form_name: "Avaliação" });
    expect(m.form_name).toBe("Avaliação");
  });

  it("prefers the more specific alias when several are present", () => {
    const m = mapSheetFields({ id: "row-3", lead_id: "l_777" });
    expect(m.external_id).toBe("l_777");
  });

  it("treats blank cells as null rather than empty strings", () => {
    const m = mapSheetFields({ full_name: "   ", phone_number: "", email: "a@b.com" });
    expect(m.name).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.email).toBe("a@b.com");
  });

  it("falls through to the next alias when the preferred column is blank", () => {
    const m = mapSheetFields({ full_name: "", nome: "Carla" });
    expect(m.name).toBe("Carla");
  });

  it("returns all-null for an unrecognizable row without throwing", () => {
    const m = mapSheetFields({ "Coluna A": "x", "Coluna B": "y" });
    expect(m.name).toBeNull();
    expect(m.phone).toBeNull();
    expect(m.external_id).toBeNull();
    expect(m.raw).toEqual({ "Coluna A": "x", "Coluna B": "y" });
  });

  it("survives an empty or missing row", () => {
    expect(mapSheetFields({}).raw).toEqual({});
    expect(mapSheetFields(undefined as never).name).toBeNull();
  });

  it("ignores blank headers and keeps the first on a normalization collision", () => {
    const m = mapSheetFields({ "": "orphan", Nome: "Primeira", nome: "Segunda" });
    expect(m.name).toBe("Primeira");
    expect(m.raw[""]).toBeUndefined();
  });
});
