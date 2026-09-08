import { describe, it, expect } from "vitest";
import { buildNewLeadBlocks } from "./notify";
import type { MappedLead } from "./mapping";

function lead(over: Partial<MappedLead> = {}): MappedLead {
  return {
    external_id: "l1",
    name: "Ana Souza",
    phone: "5527999998888",
    email: "ana@example.com",
    campaign: "Emagrecimento — ago",
    form_name: "Protocolo",
    submitted_at: "2026-09-08T12:00:00.000Z",
    raw: {},
    ...over,
  };
}

/** The `fields` of the one section block, as `label -> value`. */
function fields(l: MappedLead): Record<string, string> {
  const section = buildNewLeadBlocks(l).blocks.find((b) => b.type === "section") as {
    fields: { text: string }[];
  };
  return Object.fromEntries(
    section.fields.map((f) => {
      const [label, ...rest] = f.text.split("\n");
      return [label.replaceAll("*", ""), rest.join("\n")];
    })
  );
}

describe("buildNewLeadBlocks", () => {
  it("shows the neighbourhood and the weight goal from the form's own answers", () => {
    const got = fields(
      lead({
        raw: {
          "Em qual bairro você mora?": "Praia da Costa",
          "Quantos quilos você quer perder?": "12kg",
        },
      })
    );
    expect(got["Bairro"]).toBe("Praia da Costa");
    expect(got["Quer perder"]).toBe("12kg");
  });

  // Asked for on 08/09/2026: one campaign and one form, so both lines said the same
  // thing on every single alert.
  it("no longer carries the campaign or the form name", () => {
    const got = fields(lead());
    expect(got).not.toHaveProperty("Campanha");
    expect(got).not.toHaveProperty("Formulário");
    expect(Object.keys(got)).toEqual(["Nome", "Telefone", "Bairro", "Quer perder"]);
  });

  it("keeps the message shape when the old form (no new questions) sends a lead", () => {
    const got = fields(lead({ raw: { "Nome completo": "Ana Souza" } }));
    expect(got["Nome"]).toBe("Ana Souza");
    expect(got["Bairro"]).toBe("—");
    expect(got["Quer perder"]).toBe("—");
  });

  it("cannot be made to inject Slack markup from a lead's own answer", () => {
    const got = fields(lead({ raw: { Bairro: "<https://evil.example|clique>" } }));
    expect(got["Bairro"]).toBe("&lt;https://evil.example|clique&gt;");
  });

  it("names the lead in the fallback text, for the notification popup", () => {
    expect(buildNewLeadBlocks(lead()).fallbackText).toBe(
      "Novo lead do formulário: Ana Souza — 5527999998888"
    );
  });
});
