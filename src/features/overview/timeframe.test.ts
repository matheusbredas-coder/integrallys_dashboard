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
    { id: "1", cadastro_at: "2026-06-16T09:00:00Z", numero_vendas: 1 },
    { id: "2", cadastro_at: "2026-06-15T09:00:00Z", numero_vendas: 2 },
    { id: "3", cadastro_at: "2026-06-02T09:00:00Z", numero_vendas: 0 },
    { id: "4", cadastro_at: "2026-05-02T09:00:00Z", numero_vendas: 1 },
  ],
  agenda: [
    { appointment_at: "2026-06-16T14:00:00Z", pendente: false }, // today, realized
    { appointment_at: "2026-06-16T15:00:00Z", pendente: true },  // today, pending (not counted)
    { appointment_at: "2026-06-15T14:00:00Z", pendente: false }, // this week, realized
    { appointment_at: "2026-06-02T14:00:00Z", pendente: false }, // this month, realized
    { appointment_at: "2026-05-20T14:00:00Z", pendente: false }, // this year, realized
  ],
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

    expect(today.kpi.atendimentos).toBe(1);  // 1 realized today (the pending one excluded)
    expect(week.kpi.atendimentos).toBe(2);   // today + 06-15
    expect(month.kpi.atendimentos).toBe(3);  // + 06-02
    expect(year.kpi.atendimentos).toBe(4);   // + 05-20

    expect(today.topProcedures).toEqual([{ name: "BOTOX", qty: 1 }]);
    expect(week.topProcedures[0]).toEqual({ name: "BOTOX", qty: 2 });
    expect(month.topProcedures.map((r) => r.name)).toContain("BOTOX");
    expect(year.topProcedures.map((r) => r.name)).toContain("BOTOX");

    expect(today.chart.length).toBeGreaterThan(0);
    expect(week.chart.length).toBeGreaterThan(0);
    expect(month.chart.length).toBeGreaterThan(0);
    expect(year.chart.length).toBeGreaterThan(0);
  });

  it("conversion = registration-cohort patients who have ever bought", () => {
    const conv = (s: ReturnType<typeof buildOverviewSlice>) => s.gauges.find((g) => g.key === "conversion")!.pct;
    expect(conv(buildOverviewSlice(source, "today"))).toBeCloseTo(1 / 1); // registered today: id1 (bought)
    expect(conv(buildOverviewSlice(source, "week"))).toBeCloseTo(2 / 2);  // id1, id2 (both bought)
    expect(conv(buildOverviewSlice(source, "month"))).toBeCloseTo(2 / 3); // id1, id2, id3 (id3 no sale)
    expect(conv(buildOverviewSlice(source, "year"))).toBeCloseTo(3 / 4);  // id1..id4 (id3 no sale)
  });
});
