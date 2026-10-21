import { describe, expect, it } from "vitest";
import type { DateRange } from "@/features/overview/types";
import {
  buildChart,
  buildCostChart,
  centsToUsd,
  channelLabel,
  dayKey,
  deviceLabel,
  ga4DateToKey,
  inRange,
  isoToKey,
  rankChannels,
  rankDevices,
  rankModels,
  sumCost,
  sumTraffic,
  topPages,
} from "./aggregate";
import type { CostByModel, CostDaily, PageSlice, TrafficDaily, TrafficSlice } from "./types";

const range = (start: string, end: string): DateRange => ({
  start: new Date(`${start}T00:00:00Z`),
  end: new Date(`${end}T00:00:00Z`),
});

describe("chaves de data", () => {
  it("converte a data do GA4 (YYYYMMDD)", () => {
    expect(ga4DateToKey("20260908")).toBe("2026-09-08");
  });

  it("converte o carimbo RFC 3339 da Anthropic", () => {
    expect(isoToKey("2026-09-08T00:00:00Z")).toBe("2026-09-08");
  });

  it("converte a data do seletor de período", () => {
    expect(dayKey(new Date(Date.UTC(2026, 8, 8)))).toBe("2026-09-08");
  });
});

describe("inRange", () => {
  it("inclui as duas pontas", () => {
    const r = range("2026-09-01", "2026-09-30");
    expect(inRange("2026-09-01", r)).toBe(true);
    expect(inRange("2026-09-30", r)).toBe(true);
  });

  it("exclui fora do intervalo", () => {
    const r = range("2026-09-01", "2026-09-30");
    expect(inRange("2026-08-31", r)).toBe(false);
    expect(inRange("2026-10-01", r)).toBe(false);
  });

  // O seletor devolve {start: d, end: d} quando se escolhe um dia só; se as pontas fossem
  // exclusivas a tela ficaria vazia justamente no caso mais usado ("Hoje").
  it("um único dia devolve esse dia", () => {
    expect(inRange("2026-09-08", range("2026-09-08", "2026-09-08"))).toBe(true);
  });
});

const daily: TrafficDaily[] = [
  { date: "2026-08-31", sessions: 100, users: 90, views: 200 },
  { date: "2026-09-01", sessions: 10, users: 8, views: 20 },
  { date: "2026-09-02", sessions: 5, users: 5, views: 9 },
];

describe("sumTraffic", () => {
  it("soma só o que está no período", () => {
    expect(sumTraffic(daily, range("2026-09-01", "2026-09-02"))).toEqual({
      sessions: 15,
      users: 13,
      views: 29,
    });
  });

  it("período sem dado devolve zeros, não NaN", () => {
    expect(sumTraffic(daily, range("2026-07-01", "2026-07-31"))).toEqual({
      sessions: 0,
      users: 0,
      views: 0,
    });
  });
});

describe("buildChart", () => {
  it("rotula em dd/mm e mantém a ordem", () => {
    const points = buildChart(daily, range("2026-09-01", "2026-09-02"));
    expect(points.map((p) => p.label)).toEqual(["01/09", "02/09"]);
  });

  // O rótulo é montado a partir da chave "YYYY-MM-DD" forçada em UTC. Sem isso, um runtime
  // a oeste de Greenwich (Vercel roda em UTC, mas a máquina local não) empurraria o dia 1
  // para "31/08".
  it("não escorrega um dia por causa do fuso", () => {
    const points = buildChart([{ date: "2026-09-01", sessions: 1, users: 1, views: 1 }], range("2026-09-01", "2026-09-01"));
    expect(points[0].label).toBe("01/09");
  });
});

const channels: TrafficSlice[] = [
  { date: "2026-09-01", key: "Paid Social", sessions: 30 },
  { date: "2026-09-02", key: "Paid Social", sessions: 30 },
  { date: "2026-09-01", key: "Direct", sessions: 40 },
  { date: "2026-08-01", key: "Referral", sessions: 999 },
];

describe("rankChannels", () => {
  it("agrupa por canal, ordena pelo maior e calcula a fatia", () => {
    const ranked = rankChannels(channels, range("2026-09-01", "2026-09-30"));
    expect(ranked.map((r) => [r.label, r.sessions, Math.round(r.share)])).toEqual([
      ["Social pago", 60, 60],
      ["Direto", 40, 40],
    ]);
  });

  it("ignora o que está fora do período", () => {
    const ranked = rankChannels(channels, range("2026-09-01", "2026-09-30"));
    expect(ranked.find((r) => r.key === "Referral")).toBeUndefined();
  });
});

describe("rótulos", () => {
  it("traduz os canais conhecidos", () => {
    expect(channelLabel("Organic Search")).toBe("Busca orgânica");
    expect(deviceLabel("mobile")).toBe("Celular");
  });

  // Se o Google criar um canal novo, ele tem que aparecer com o nome cru — sumir da tela
  // seria pior do que aparecer em inglês.
  it("deixa passar um canal desconhecido em vez de escondê-lo", () => {
    expect(channelLabel("Canal Novo Do Google")).toBe("Canal Novo Do Google");
    expect(deviceLabel("fridge")).toBe("fridge");
  });
});

describe("rankDevices", () => {
  it("soma por aparelho", () => {
    const rows: TrafficSlice[] = [
      { date: "2026-09-01", key: "mobile", sessions: 8 },
      { date: "2026-09-02", key: "mobile", sessions: 2 },
      { date: "2026-09-01", key: "desktop", sessions: 5 },
    ];
    const ranked = rankDevices(rows, range("2026-09-01", "2026-09-30"));
    expect(ranked[0]).toMatchObject({ label: "Celular", sessions: 10 });
  });
});

describe("topPages", () => {
  const pages: PageSlice[] = [
    { date: "2026-09-01", path: "/", views: 50 },
    { date: "2026-09-02", path: "/", views: 30 },
    { date: "2026-09-01", path: "/protocolos/emagrecimento", views: 40 },
  ];

  it("soma as visualizações por caminho e ordena", () => {
    expect(topPages(pages, range("2026-09-01", "2026-09-30"))).toEqual([
      { path: "/", views: 80 },
      { path: "/protocolos/emagrecimento", views: 40 },
    ]);
  });

  it("respeita o limite", () => {
    expect(topPages(pages, range("2026-09-01", "2026-09-30"), 1)).toHaveLength(1);
  });
});

describe("centsToUsd", () => {
  // A Admin API devolve o valor na MENOR unidade da moeda: "123.45" em USD é $1,2345.
  // Ler como dólar direto multiplicaria a conta por 100.
  it("trata a string como centavos", () => {
    expect(centsToUsd("123.45")).toBeCloseTo(1.2345, 6);
    expect(centsToUsd("100")).toBe(1);
  });

  it("aguenta valor ausente ou inválido sem virar NaN", () => {
    expect(centsToUsd(null)).toBe(0);
    expect(centsToUsd(undefined)).toBe(0);
    expect(centsToUsd("abc")).toBe(0);
  });
});

describe("custo", () => {
  const cost: CostDaily[] = [
    { date: "2026-09-01", usd: 1.5 },
    { date: "2026-09-02", usd: 2.25 },
    { date: "2026-08-01", usd: 99 },
  ];

  it("soma só o período pedido", () => {
    expect(sumCost(cost, range("2026-09-01", "2026-09-30"))).toBeCloseTo(3.75, 6);
  });

  it("monta o gráfico com rótulo dd/mm", () => {
    expect(buildCostChart(cost, range("2026-09-01", "2026-09-02")).map((p) => p.label)).toEqual(["01/09", "02/09"]);
  });

  it("agrupa por modelo e calcula a fatia", () => {
    const rows: CostByModel[] = [
      { date: "2026-09-01", model: "claude-sonnet-5", usd: 3 },
      { date: "2026-09-02", model: "claude-sonnet-5", usd: 3 },
      { date: "2026-09-01", model: "claude-opus-4-8", usd: 2 },
    ];
    const ranked = rankModels(rows, range("2026-09-01", "2026-09-30"));
    expect(ranked.map((r) => [r.model, r.usd, Math.round(r.share)])).toEqual([
      ["claude-sonnet-5", 6, 75],
      ["claude-opus-4-8", 2, 25],
    ]);
  });
});
