import { describe, it, expect } from "vitest";
import { parseLeadEmail } from "./email-parse";
import { coerceIngestFields, mapSheetFields } from "./mapping";

// The shape the "Lead Nova" automation sends: one `Label: value` per line.
//
// NOTE: this is a stand-in until a real message is captured from the n8n Gmail Trigger's
// output panel. The labels below are the ones mapping.ts already has aliases for, so a
// real email that uses different wording maps through `ALIASES`, not through this fixture.
const leadNovaEmail = [
  "Você recebeu uma nova lead!",
  "",
  "Nome completo: Ana Souza",
  "Telefone: +55 (41) 99999-8888",
  "E-mail: Ana@Example.COM",
  "Campanha: Harmonização - Julho",
  "Formulário: Avaliação gratuita",
  "Lead ID: l_10223344",
  "Data de envio: 31/07/2026 14:23",
  "",
  "-- ",
  "Enviado automaticamente.",
].join("\n");

describe("parseLeadEmail", () => {
  it("reads every `Label: value` line into a flat map", () => {
    expect(parseLeadEmail(leadNovaEmail)).toEqual({
      "Nome completo": "Ana Souza",
      Telefone: "+55 (41) 99999-8888",
      "E-mail": "Ana@Example.COM",
      Campanha: "Harmonização - Julho",
      Formulário: "Avaliação gratuita",
      "Lead ID": "l_10223344",
      "Data de envio": "31/07/2026 14:23",
    });
  });

  it("splits on the first colon so a value may contain colons", () => {
    expect(parseLeadEmail("Data: 31/07/2026 14:23:05")).toEqual({ Data: "31/07/2026 14:23:05" });
  });

  it("trims the whitespace an email template pads with", () => {
    expect(parseLeadEmail("  Nome  :   Ana Souza  ")).toEqual({ Nome: "Ana Souza" });
  });

  it("reads a line that a template bulleted", () => {
    expect(parseLeadEmail("- Nome: Ana\n* Telefone: 41999998888\n• E-mail: a@b.com")).toEqual({
      Nome: "Ana",
      Telefone: "41999998888",
      "E-mail": "a@b.com",
    });
  });

  it("keeps the first value when a label repeats", () => {
    expect(parseLeadEmail("E-mail: primeiro@x.com\nE-mail: segundo@x.com")).toEqual({
      "E-mail": "primeiro@x.com",
    });
  });

  it("ignores lines that carry no label", () => {
    expect(parseLeadEmail("Você recebeu uma nova lead!\n\n---\nNome: Ana")).toEqual({ Nome: "Ana" });
  });

  it("ignores a label with no value", () => {
    expect(parseLeadEmail("Telefone:\nNome: Ana")).toEqual({ Nome: "Ana" });
  });

  it("does not read a URL as a label", () => {
    const fields = parseLeadEmail("Ver lead: veja\nhttps://facebook.com/lead/123\nNome: Ana");
    expect(fields.https).toBeUndefined();
    expect(fields.Nome).toBe("Ana");
  });

  it("does not read a long prose line as a label", () => {
    const footer =
      "Esta mensagem foi enviada automaticamente pelo sistema e não deve ser respondida: " +
      "obrigado";
    expect(parseLeadEmail(footer)).toEqual({});
  });

  // The length bound is the only prose guard, so a short footer line does become a field.
  // Accepted on purpose: it lands in `raw` as one unmapped key, whereas a tighter bound would
  // drop real form questions, which Meta allows to run to a full sentence.
  it("keeps a form question long enough to be a sentence", () => {
    const question = "Qual é o seu principal objetivo com o tratamento?";
    expect(parseLeadEmail(`${question}: Rejuvenescimento`)).toEqual({
      [question]: "Rejuvenescimento",
    });
  });

  it("reads an HTML body by falling back to its text", () => {
    const html =
      "<html><body><p>Nome completo: Ana Souza</p>" +
      "<p>Telefone: +55 (41) 99999-8888<br/>E-mail: ana&#64;example.com</p></body></html>";
    expect(parseLeadEmail(html)).toEqual({
      "Nome completo": "Ana Souza",
      Telefone: "+55 (41) 99999-8888",
      "E-mail": "ana@example.com",
    });
  });

  it("decodes the entities an HTML body escapes", () => {
    expect(parseLeadEmail("<p>Procedimento: Botox &amp; Preenchimento</p>")).toEqual({
      Procedimento: "Botox & Preenchimento",
    });
  });

  it("returns {} for anything unusable instead of throwing", () => {
    for (const junk of ["", "   ", null, undefined, 42, {}, []]) {
      expect(parseLeadEmail(junk as never)).toEqual({});
    }
  });
});

describe("parseLeadEmail + mapSheetFields (the ingest route's path)", () => {
  it("maps a Lead Nova email onto form_leads columns", () => {
    const m = mapSheetFields(parseLeadEmail(leadNovaEmail));
    expect(m.external_id).toBe("l_10223344");
    expect(m.name).toBe("Ana Souza");
    expect(m.phone).toBe("5541999998888");
    expect(m.email).toBe("ana@example.com");
    expect(m.campaign).toBe("Harmonização - Julho");
    expect(m.form_name).toBe("Avaliação gratuita");
    expect(m.submitted_at).toBe(new Date(2026, 6, 31, 14, 23, 0).toISOString());
  });

  it("keeps an unmapped question in raw", () => {
    const m = mapSheetFields(parseLeadEmail("Nome: Ana\nQual seu incômodo?: rugas na testa"));
    expect(m.raw["Qual seu incômodo?"]).toBe("rugas na testa");
  });
});

describe("coerceIngestFields (email body shape)", () => {
  const n8nBody = {
    message_id: "1994a1f0c2d3e4f5",
    subject: "Lead Nova",
    received_at: "2026-07-31T14:23:05.000Z",
    body: leadNovaEmail,
  };

  it("parses the email body into fields", () => {
    const fields = coerceIngestFields(n8nBody);
    expect(fields["Nome completo"]).toBe("Ana Souza");
    expect(fields["Lead ID"]).toBe("l_10223344");
  });

  it("consumes `body` rather than leaving the whole email in raw", () => {
    expect(coerceIngestFields(n8nBody).body).toBeUndefined();
  });

  it("keeps message_id and subject so a lead is traceable to its email", () => {
    const raw = mapSheetFields(coerceIngestFields(n8nBody)).raw;
    expect(raw.message_id).toBe("1994a1f0c2d3e4f5");
    expect(raw.subject).toBe("Lead Nova");
  });

  it("lets a parsed answer outrank colliding envelope metadata", () => {
    const fields = coerceIngestFields({ subject: "Lead Nova", body: "subject: Resposta do lead" });
    expect(fields.subject).toBe("Resposta do lead");
  });

  it("leaves the Ottokit and Sheets shapes untouched", () => {
    const fieldData = [{ name: "full_name", values: ["Ana Souza"] }];
    expect(coerceIngestFields({ id: "l_1", field_data: fieldData }).full_name).toBe("Ana Souza");
    const fields = { full_name: "João" };
    expect(coerceIngestFields({ fields, body: leadNovaEmail })).toBe(fields);
  });

  // The envelope alone is not a lead. Without this the route would see `message_id` and
  // `subject` as "fields", skip its 400, and store a row with every column null.
  it("yields no fields for an email it cannot parse, so the route can 400", () => {
    expect(
      coerceIngestFields({ message_id: "x", subject: "Lead Nova", body: "Nenhum campo aqui." })
    ).toEqual({});
    expect(coerceIngestFields({ message_id: "x", subject: "Lead Nova", body: "" })).toEqual({});
  });
});
