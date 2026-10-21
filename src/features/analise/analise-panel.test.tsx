import { expect, test, vi } from "vitest";
import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { AnalisePanel } from "./analise-panel";
import type { AnaliseSource } from "./types";

// O recharts mede o container para desenhar, e no jsdom ele tem largura zero — o gráfico
// nunca renderiza. A tela é o que está sendo testado aqui, não o desenho das barras.
vi.mock("./analise-charts", () => ({
  TrafficChart: () => <div data-testid="grafico-visitas" />,
  CostChart: () => <div data-testid="grafico-custo" />,
}));

// Uma data fixa dentro do período padrão do painel ("Mês"), para o recorte não depender
// do dia em que a suíte roda.
const NOW = new Date("2026-09-15T12:00:00Z");
const day = (d: string) => `2026-09-${d}`;

function source(overrides: Partial<AnaliseSource> = {}): AnaliseSource {
  return {
    nowIso: NOW.toISOString(),
    traffic: {
      ok: true,
      data: {
        daily: [
          { date: day("01"), sessions: 40, users: 35, views: 90 },
          { date: day("02"), sessions: 60, users: 50, views: 110 },
        ],
        channels: [
          { date: day("01"), key: "Paid Social", sessions: 70 },
          { date: day("02"), key: "Direct", sessions: 30 },
        ],
        devices: [{ date: day("01"), key: "mobile", sessions: 100 }],
        pages: [{ date: day("01"), path: "/protocolos/emagrecimento", views: 200 }],
      },
    },
    cost: {
      ok: true,
      data: {
        daily: [
          { date: day("01"), usd: 1.5 },
          { date: day("02"), usd: 0.5 },
        ],
        byModel: [{ date: day("01"), model: "claude-sonnet-5", usd: 2 }],
      },
    },
    ...overrides,
  };
}

test("soma as visitas do período e traduz o canal", () => {
  render(<AnalisePanel source={source()} />);

  expect(screen.getByText("100")).toBeInTheDocument(); // 40 + 60 visitas
  expect(screen.getByText("Social pago")).toBeInTheDocument();
  expect(screen.getByText("Celular")).toBeInTheDocument();
  expect(screen.getByText("/protocolos/emagrecimento")).toBeInTheDocument();
});

test("mostra o gasto em dólar, não em real", () => {
  render(<AnalisePanel source={source()} />);

  const total = screen.getByText("Gasto no período").parentElement!;
  expect(within(total).getByText(/US\$/)).toBeInTheDocument();
  expect(within(total).queryByText(/R\$/)).not.toBeInTheDocument();
});

// O aviso de que o número junta produção e desenvolvimento é o que impede a leitura errada
// do custo; se ele sumir da tela, o número passa a mentir.
test("avisa que o custo não é só o da clínica", () => {
  render(<AnalisePanel source={source()} />);
  expect(screen.getByText(/não é só o gasto da clínica/i)).toBeInTheDocument();
});

test("uma fonte fora do ar não derruba a outra", () => {
  render(
    <AnalisePanel
      source={source({ traffic: { ok: false, error: "Google Analytics não está configurado." } })}
    />
  );

  // O erro do Google aparece...
  expect(screen.getByText("Google Analytics não está configurado.")).toBeInTheDocument();
  // ...e o bloco de custo continua na tela com o número dele.
  expect(screen.getByText("Gasto no período")).toBeInTheDocument();
  expect(screen.getByTestId("grafico-custo")).toBeInTheDocument();
});

test("as duas fontes fora do ar mostram os dois avisos", () => {
  render(
    <AnalisePanel
      source={source({
        traffic: { ok: false, error: "Falhou o Google." },
        cost: { ok: false, error: "Falhou a Anthropic." },
      })}
    />
  );

  expect(screen.getByText("Falhou o Google.")).toBeInTheDocument();
  expect(screen.getByText("Falhou a Anthropic.")).toBeInTheDocument();
  expect(screen.queryByTestId("grafico-visitas")).not.toBeInTheDocument();
});
