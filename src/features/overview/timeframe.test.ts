import { describe, expect, it } from "vitest";
import { buildOverviewSlice } from "./timeframe";
import type { OverviewSource } from "./types";

const source: OverviewSource = {
  vendas: [
    { sold_at: "2026-06-16T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-15T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 200, valor_pago: 150, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-02T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, procedimentos: "MONJAURO 2,5 MG (2)" },
    { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "3", cliente_nome: "CARLA", total: 400, valor_pago: 400, procedimentos: "PEELING (1)" },
  ],
  clientes: [
    { id: "1", cadastro_at: "2026-06-16T09:00:00Z" },
    { id: "2", cadastro_at: "2026-06-15T09:00:00Z" },
    { id: "3", cadastro_at: "2026-06-02T09:00:00Z" },
    { id: "4", cadastro_at: "2026-05-02T09:00:00Z" },
  ],
  agenda: [],
  goals: { monthly_revenue_goal: 1000, monthly_new_patient_goal: 4, avg_ticket_goal: 100 },
  recent: [],
  nowIso: "2026-06-16T12:00:00Z",
};

describe("buildOverviewSlice", () => {
  it("changes KPI and chart data by timeframe", () => {
    const today = buildOverviewSlice(source, "today");
    const week = buildOverviewSlice(source, "week");
    const month = buildOverviewSlice(source, "month");
    const year = buildOverviewSlice(source, "year");

    expect(today.kpi.sales).toBe(1);
    expect(week.kpi.sales).toBe(2);
    expect(month.kpi.sales).toBe(3);
    expect(year.kpi.sales).toBe(4);

    expect(today.topProcedures).toEqual([{ name: "BOTOX", qty: 1 }]);
    expect(week.topProcedures[0]).toEqual({ name: "BOTOX", qty: 2 });
    expect(month.topProcedures.map((r) => r.name)).toContain("BOTOX");
    expect(year.topProcedures.map((r) => r.name)).toContain("BOTOX");

    expect(today.chart.length).toBeGreaterThan(0);
    expect(week.chart.length).toBeGreaterThan(0);
    expect(month.chart.length).toBeGreaterThan(0);
    expect(year.chart.length).toBeGreaterThan(0);
  });
});
