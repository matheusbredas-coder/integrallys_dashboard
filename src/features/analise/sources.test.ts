import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCost } from "./anthropic-cost";
import { fetchTraffic } from "./ga4";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const ENV_KEYS = ["GA4_PROPERTY_ID", "GA4_SA_CLIENT_EMAIL", "GA4_SA_PRIVATE_KEY", "ANTHROPIC_ADMIN_KEY"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

// Este é o estado em que a página nasce, antes de qualquer credencial existir. Tem que ser
// um erro explicando o que falta — nunca um crash, que derrubaria a página inteira.
describe("sem credencial configurada", () => {
  it("o GA4 diz qual variável falta", async () => {
    await expect(fetchTraffic()).rejects.toThrow(/GA4_PROPERTY_ID/);
  });

  it("o custo diz qual variável falta", async () => {
    await expect(fetchCost()).rejects.toThrow(/ANTHROPIC_ADMIN_KEY/);
  });
});

// Os dois erros abaixo chegam do Google como PERMISSION_DENIED e mandam para telas
// diferentes; trocá-los faz procurar no lugar errado. As mensagens são as reais.
describe("GA4: separa os dois PERMISSION_DENIED", () => {
  function stubGa4Failure(message: string) {
    process.env.GA4_PROPERTY_ID = "553218953";
    process.env.GA4_SA_CLIENT_EMAIL = "robo@projeto.iam.gserviceaccount.com";
    process.env.GA4_SA_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n";
    vi.spyOn(BetaAnalyticsDataClient.prototype, "batchRunReports").mockRejectedValue(new Error(message));
  }

  it("a Data API desligada manda ativar a API, não mexer no acesso", async () => {
    stubGa4Failure(
      "7 PERMISSION_DENIED: Google Analytics Data API has not been used in project 1006213315188 before or it is disabled."
    );
    await expect(fetchTraffic()).rejects.toThrow(/Data API está desligada/);
  });

  it("a conta sem acesso à propriedade manda liberar como Leitor", async () => {
    stubGa4Failure("7 PERMISSION_DENIED: User does not have sufficient permissions for this property.");
    await expect(fetchTraffic()).rejects.toThrow(/Leitor \(Viewer\)/);
  });
});

describe("custo do Claude", () => {
  // 401 e 403 são erros diferentes com a mesma causa prática, e é sempre a mesma: puseram
  // ali a chave comum. O 403 foi visto de verdade — uma sk-ant-api03-... válida, que a
  // Anthropic aceita e então recusa por falta de permissão de Admin. Só o 401 estava
  // tratado, e o 403 caía no texto genérico "respondeu 403", que não diz o que corrigir.
  it.each([401, 403])("explica que a chave comum não serve quando a Anthropic devolve %i", async (status) => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-api03-chave-errada";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));

    await expect(fetchCost()).rejects.toThrow(/Admin key/);
  });

  it("soma os itens do dia e converte de centavos para dólar", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin01-ok";
    const body = {
      data: [
        {
          starting_at: "2026-09-01T00:00:00Z",
          ending_at: "2026-09-02T00:00:00Z",
          results: [
            { amount: "100", model: "claude-sonnet-5", cost_type: "tokens" },
            { amount: "50", model: "claude-sonnet-5", cost_type: "tokens" },
          ],
        },
      ],
      has_more: false,
      next_page: null,
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })));

    const cost = await fetchCost();
    // "100" + "50" centavos = 150 centavos = US$ 1,50
    expect(cost.daily).toEqual([{ date: "2026-09-01", usd: 1.5 }]);
    expect(cost.byModel).toEqual([{ date: "2026-09-01", model: "claude-sonnet-5", usd: 1.5 }]);
  });

  it("segue a paginação até has_more virar falso", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin01-ok";
    const page1 = {
      data: [{ starting_at: "2026-09-01T00:00:00Z", results: [{ amount: "100", model: "m", cost_type: "tokens" }] }],
      has_more: true,
      next_page: "page_2",
    };
    const page2 = {
      data: [{ starting_at: "2026-09-02T00:00:00Z", results: [{ amount: "200", model: "m", cost_type: "tokens" }] }],
      has_more: false,
      next_page: null,
    };
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(calls.length === 1 ? page1 : page2), { status: 200 });
      })
    );

    const cost = await fetchCost();
    expect(cost.daily).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain("page=page_2");
  });

  // Um next_page que voltasse sempre igual deixaria o pedido rodando até o timeout da
  // função na Vercel; o teto de páginas é o que garante que ele termina.
  it("não roda para sempre se a paginação nunca acabar", async () => {
    process.env.ANTHROPIC_ADMIN_KEY = "sk-ant-admin01-ok";
    const loop = {
      data: [{ starting_at: "2026-09-01T00:00:00Z", results: [] }],
      has_more: true,
      next_page: "sempre-a-mesma",
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(loop), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCost();
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
  });
});
