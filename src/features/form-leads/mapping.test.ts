import { describe, it, expect } from "vitest";
import {
  coerceIngestFields,
  flattenFieldData,
  mapSheetFields,
  normalizeHeader,
  parseSubmittedAt,
  resolveExternalId,
  resolveSource,
} from "./mapping";

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

// What Ottokit's Facebook Lead Ads "New Lead" trigger POSTs: ad metadata flat at the top
// level, the lead's own answers nested in `field_data`. `form_name` is a literal typed
// into the Ottokit request body — the trigger only exposes `form_id`.
const ottokitBody = {
  id: "l_10223344",
  created_time: "2026-07-31T14:23:05+0000",
  campaign_id: "120000",
  campaign_name: "Harmonização - Julho",
  adset_id: "230000",
  adset_name: "Curitiba 25-45",
  ad_id: "340000",
  ad_name: "Vídeo depoimento",
  form_id: "998877",
  form_name: "Avaliação gratuita",
  field_data: [
    { name: "full_name", values: ["Ana Souza"] },
    { name: "phone_number", values: ["+55 (41) 99999-8888"] },
    { name: "email", values: ["Ana@Example.COM"] },
  ],
};

describe("flattenFieldData", () => {
  it("flattens Meta's { name, values } entries", () => {
    expect(flattenFieldData(ottokitBody.field_data)).toEqual({
      full_name: "Ana Souza",
      phone_number: "+55 (41) 99999-8888",
      email: "Ana@Example.COM",
    });
  });

  it("flattens the same array handed over as a JSON string", () => {
    expect(flattenFieldData(JSON.stringify(ottokitBody.field_data))).toEqual(
      flattenFieldData(ottokitBody.field_data)
    );
  });

  it("accepts the collapsed { name, value } shape some connectors emit", () => {
    expect(flattenFieldData([{ name: "full_name", value: "Ana Souza" }])).toEqual({
      full_name: "Ana Souza",
    });
  });

  it("joins a multi-answer checkbox question", () => {
    const flat = flattenFieldData([
      { name: "Quais procedimentos?", values: ["Botox", "Preenchimento", ""] },
    ]);
    expect(flat["Quais procedimentos?"]).toBe("Botox, Preenchimento");
  });

  it("keeps the first entry when a question name repeats", () => {
    const flat = flattenFieldData([
      { name: "email", values: ["primeiro@example.com"] },
      { name: "email", values: ["segundo@example.com"] },
    ]);
    expect(flat.email).toBe("primeiro@example.com");
  });

  it("returns {} for anything unusable instead of throwing", () => {
    for (const junk of [null, undefined, 42, "not json", "", "{}", {}, [1, 2], [null]]) {
      expect(flattenFieldData(junk)).toEqual({});
    }
  });

  it("skips entries with no usable name", () => {
    expect(flattenFieldData([{ name: "   ", values: ["x"] }, { values: ["y"] }])).toEqual({});
  });
});

describe("coerceIngestFields", () => {
  it("returns an explicit `fields` map verbatim", () => {
    const fields = { full_name: "João Lima", Telefone: "41988887777" };
    expect(coerceIngestFields({ row: 7, submitted_at: "2026-07-31", fields })).toBe(fields);
  });

  it("merges field_data over the top-level ad metadata", () => {
    const fields = coerceIngestFields(ottokitBody);
    expect(fields.full_name).toBe("Ana Souza");
    expect(fields.campaign_name).toBe("Harmonização - Julho");
    expect(fields.ad_name).toBe("Vídeo depoimento");
    expect(fields.field_data).toBeUndefined(); // consumed, not left as a raw column
  });

  it("lets a form question outrank the ad metadata it collides with", () => {
    const fields = coerceIngestFields({
      campaign_name: "Nome da campanha",
      field_data: [{ name: "campaign_name", values: ["Resposta do lead"] }],
    });
    expect(fields.campaign_name).toBe("Resposta do lead");
  });

  it("never lets the body-carried secret reach the fields (and so `raw`)", () => {
    const fields = coerceIngestFields({ secret: "s3cr3t", full_name: "Ana" });
    expect(fields.secret).toBeUndefined();
    expect(mapSheetFields(fields).raw.secret).toBeUndefined();
  });

  it("drops the envelope keys and any null values", () => {
    const fields = coerceIngestFields({
      row: 7,
      submitted_at: "2026-07-31T14:23:05+0000",
      adset_name: null,
      full_name: "Ana",
    });
    expect(fields).toEqual({ full_name: "Ana" });
  });

  it("stringifies an unexpected nested value so it stays readable in raw", () => {
    const fields = coerceIngestFields({ custom_disclaimer: { checked: true } });
    expect(fields.custom_disclaimer).toBe('{"checked":true}');
  });

  it("returns {} for a non-object body", () => {
    expect(coerceIngestFields(null)).toEqual({});
    expect(coerceIngestFields("oi")).toEqual({});
    expect(coerceIngestFields([1, 2])).toEqual({});
  });
});

describe("resolveExternalId", () => {
  it("prefers the lead id the payload carried", () => {
    expect(resolveExternalId("l_10223344", { message_id: "1994a1f0" })).toBe("l_10223344");
  });

  it("falls back to the Gmail message id so a retry can't insert twice", () => {
    expect(resolveExternalId(null, { message_id: "1994a1f0" })).toBe("gmail:1994a1f0");
  });

  it("ignores a blank or non-string message id", () => {
    expect(resolveExternalId(null, { message_id: "   " })).toBeNull();
    expect(resolveExternalId(null, { message_id: 42 })).toBeNull();
    expect(resolveExternalId(null, {})).toBeNull();
  });
});

describe("resolveSource", () => {
  it("marks a forwarded email", () => {
    expect(resolveSource({ body: "Nome: Ana" })).toBe("gmail_lead_nova");
  });

  it("leaves every other shape on the original source", () => {
    expect(resolveSource(ottokitBody)).toBe("meta_instant_form");
    expect(resolveSource({ fields: metaRow })).toBe("meta_instant_form");
  });
});

describe("coerceIngestFields + mapSheetFields (the ingest route's path)", () => {
  it("maps a full Ottokit payload onto form_leads columns", () => {
    const m = mapSheetFields(coerceIngestFields(ottokitBody));
    expect(m.external_id).toBe("l_10223344");
    expect(m.name).toBe("Ana Souza");
    expect(m.phone).toBe("5541999998888");
    expect(m.email).toBe("ana@example.com");
    expect(m.campaign).toBe("Harmonização - Julho");
    expect(m.form_name).toBe("Avaliação gratuita");
    expect(m.submitted_at).toBe("2026-07-31T14:23:05.000Z");
  });

  it("keeps the attribution metadata in raw for later analysis", () => {
    const m = mapSheetFields(coerceIngestFields(ottokitBody));
    expect(m.raw.ad_name).toBe("Vídeo depoimento");
    expect(m.raw.adset_name).toBe("Curitiba 25-45");
    expect(m.raw.form_id).toBe("998877");
  });

  it("keeps an unmapped custom question in raw", () => {
    const m = mapSheetFields(
      coerceIngestFields({
        ...ottokitBody,
        field_data: [
          ...ottokitBody.field_data,
          { name: "Qual seu principal incômodo?", values: ["rugas na testa"] },
        ],
      })
    );
    expect(m.raw["Qual seu principal incômodo?"]).toBe("rugas na testa");
  });

  it("still records the lead when field_data is malformed", () => {
    const m = mapSheetFields(coerceIngestFields({ ...ottokitBody, field_data: "not json" }));
    expect(m.name).toBeNull();
    expect(m.external_id).toBe("l_10223344"); // top-level metadata survives
    expect(m.campaign).toBe("Harmonização - Julho");
  });

  it("still maps the retired Sheets shape unchanged", () => {
    const m = mapSheetFields(coerceIngestFields({ row: 12, fields: metaRow }));
    expect(m).toEqual(mapSheetFields(metaRow));
  });
});
