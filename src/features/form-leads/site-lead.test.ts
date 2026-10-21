import { describe, expect, it } from "vitest";
import { allowedOrigin, checkSiteLead } from "./site-lead";

const now = new Date("2026-10-21T12:00:00.000Z");

// O corpo exato que o quiz do site manda (integrallys-estética-avançada/src/lib/lead.ts).
const quiz = {
  source: "site_quiz",
  protocolo: "emagrecimento-integrado",
  "Nome completo": "Maria Teste",
  WhatsApp: "(27) 99988-7766",
  "Nome do formulário": "Site — quiz de avaliação",
  "Protocolo de interesse": "emagrecimento-integrado",
  Qualificação: "quente",
  "O que mais incomoda": "Gordura localizada, Peso",
  Regiões: "Barriga",
  Cidade: "Vila Velha",
  "Vem toda semana": "Mora na área",
  "Investimento por mês": "R$ 150 a R$ 300",
  "Quando quer começar": "Este mês",
  submitted_at: "2020-01-01T00:00:00.000Z",
};

describe("checkSiteLead", () => {
  it("aceita o quiz inteiro e carimba a hora do servidor", () => {
    const r = checkSiteLead(quiz, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.Cidade).toBe("Vila Velha");
    expect(r.body.Qualificação).toBe("quente");
    expect(r.body.submitted_at).toBe(now.toISOString());
  });

  it("aceita o formulário de contato do site", () => {
    const r = checkSiteLead({ source: "site_form", "Nome completo": "Ana", WhatsApp: "27999887766", Mensagem: "Oi" }, now);
    expect(r.ok).toBe(true);
  });

  // Sem isso, qualquer um poderia criar uma "lead do Meta" pela porta pública.
  it("recusa origem que não é do site", () => {
    expect(checkSiteLead({ ...quiz, source: "meta_instant_form" }, now)).toEqual({ ok: false, error: "Origem inválida" });
    expect(checkSiteLead({ ...quiz, source: undefined }, now).ok).toBe(false);
  });

  it("recusa sem nome ou com telefone que ninguém consegue chamar", () => {
    expect(checkSiteLead({ ...quiz, "Nome completo": " " }, now).ok).toBe(false);
    expect(checkSiteLead({ ...quiz, WhatsApp: "123" }, now).ok).toBe(false);
    expect(checkSiteLead({ ...quiz, WhatsApp: "5527999887766123" }, now).ok).toBe(false);
  });

  // Campos que mudariam a linha (id do Meta para deduplicar, `fields`, segredo) não passam.
  it("descarta tudo o que não é rótulo do site", () => {
    const r = checkSiteLead({ ...quiz, id: "l_123", lead_id: "l_123", fields: { a: 1 }, secret: "x", extra: "y" }, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.body)).not.toEqual(expect.arrayContaining(["id"]));
    expect(r.body).not.toHaveProperty("lead_id");
    expect(r.body).not.toHaveProperty("fields");
    expect(r.body).not.toHaveProperty("secret");
    expect(r.body).not.toHaveProperty("extra");
  });

  it("corta textos gigantes", () => {
    const r = checkSiteLead({ ...quiz, Mensagem: "a".repeat(5000) }, now);
    expect(r.ok && r.body.Mensagem.length).toBe(1000);
  });

  it("recusa corpo que não é objeto", () => {
    expect(checkSiteLead(null, now).ok).toBe(false);
    expect(checkSiteLead([quiz], now).ok).toBe(false);
  });
});

describe("allowedOrigin", () => {
  it("só o site no ar, com e sem www", () => {
    expect(allowedOrigin("https://integrallysestetica.com.br", "")).toBe("https://integrallysestetica.com.br");
    expect(allowedOrigin("https://www.integrallysestetica.com.br", "")).toBe("https://www.integrallysestetica.com.br");
    expect(allowedOrigin("https://evil.example", "")).toBeNull();
    expect(allowedOrigin(null, "")).toBeNull();
  });

  it("origens extras vêm do ambiente (dev local)", () => {
    expect(allowedOrigin("http://localhost:3005", "http://localhost:3005, http://localhost:3000")).toBe("http://localhost:3005");
  });
});
