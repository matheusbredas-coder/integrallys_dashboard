import { describe, expect, it } from "vitest";
import { buildOverviewSlice, rangeForPreset } from "./timeframe";
import type { OverviewSource, Timeframe } from "./types";

const source: OverviewSource = {
  vendas: [
    { sold_at: "2026-06-16T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, valor_desconto: 30, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-15T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 200, valor_pago: 150, valor_desconto: 20, procedimentos: "BOTOX (1)" },
    { sold_at: "2026-06-02T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, valor_desconto: 50, procedimentos: "MONJAURO 2,5 MG (2)" },
    { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "3", cliente_nome: "CARLA", total: 400, valor_pago: 400, valor_desconto: 100, procedimentos: "PEELING (1)" },
  ],
  clientes: [
    { id: "1", cadastro_at: "2026-06-16T09:00:00Z" },
    { id: "2", cadastro_at: "2026-06-15T09:00:00Z" },
    { id: "3", cadastro_at: "2026-06-02T09:00:00Z" },
    { id: "4", cadastro_at: "2026-05-02T09:00:00Z" },
  ],
  agenda: [
    { appointment_at: "2026-06-16T14:00:00Z", status: "realizado" }, // today, realized
    { appointment_at: "2026-06-16T15:00:00Z", status: "agendado" },  // today, still scheduled (not counted)
    { appointment_at: "2026-06-15T14:00:00Z", status: "realizado" }, // this week, realized
    { appointment_at: "2026-06-02T14:00:00Z", status: "realizado" }, // this month, realized
    { appointment_at: "2026-05-20T14:00:00Z", status: "realizado" }, // this year, realized
  ],
  goals: { monthly_revenue_goal: 1000, monthly_new_patient_goal: 4, avg_ticket_goal: 100 },
  nowIso: "2026-06-16T12:00:00Z",
  lastSync: null,
};

const now = new Date(source.nowIso);
const slice = (preset: Timeframe) => buildOverviewSlice(source, rangeForPreset(now, preset));

describe("buildOverviewSlice", () => {
  it("changes KPI and chart data by timeframe", () => {
    const today = slice("today");
    const week = slice("week");
    const month = slice("month");
    const year = slice("year");

    expect(today.kpi.sales).toBe(1);
    expect(week.kpi.sales).toBe(2);
    expect(month.kpi.sales).toBe(3);
    expect(year.kpi.sales).toBe(4);

    expect(today.kpi.atendimentos).toBe(1);  // 1 realized today (the pending one excluded)
    expect(week.kpi.atendimentos).toBe(2);   // today + 06-15
    expect(month.kpi.atendimentos).toBe(3);  // + 06-02
    expect(year.kpi.atendimentos).toBe(4);   // + 05-20

    // Taxa de conversão numerator: new patients (this period) who also bought (this period).
    // Month range 06-01..06-16: new patients 1,2,3; buyers 1,2 → 2 converted of 3 patients.
    expect(month.kpi.patients).toBe(3);
    expect(month.kpi.convertedNewPatients).toBe(2);
    // Patient 3 registered 06-02 but never bought; patient 4 (May) is outside the period.
    expect(today.kpi.convertedNewPatients).toBe(1); // patient 1, registered + bought today

    expect(today.topProcedures).toEqual([{ name: "BOTOX", qty: 1 }]);
    expect(week.topProcedures[0]).toEqual({ name: "BOTOX", qty: 2 });
    expect(month.topProcedures.map((r) => r.name)).toContain("BOTOX");
    expect(year.topProcedures.map((r) => r.name)).toContain("BOTOX");

    expect(today.chart.length).toBeGreaterThan(0);
    expect(week.chart.length).toBeGreaterThan(0);
    expect(month.chart.length).toBeGreaterThan(0);
    expect(year.chart.length).toBeGreaterThan(0);

    // recentSales is scoped to the period too — "today" only has ANA's sale.
    expect(today.recentSales.map((r) => r.patient)).toEqual(["ANA"]);
    expect(week.recentSales.map((r) => r.patient)).toEqual(["ANA", "BIA"]);
    expect(year.recentSales.map((r) => r.patient)).toEqual(["ANA", "BIA", "BIA", "CARLA"]);
  });

  it("discounts = sum of valor_desconto over the period, ring = share of gross", () => {
    const disc = (s: ReturnType<typeof buildOverviewSlice>) => s.gauges.find((g) => g.key === "discounts")!;
    // cumulative valor_desconto / (revenueBilled + valor_desconto) per preset
    expect(disc(slice("today")).value).toBe("R$ 30");
    expect(disc(slice("today")).pct).toBeCloseTo(30 / 330);   // 300 billed + 30 disc
    expect(disc(slice("week")).value).toBe("R$ 50");
    expect(disc(slice("week")).pct).toBeCloseTo(50 / 550);    // 500 + 50
    expect(disc(slice("month")).value).toBe("R$ 100");
    expect(disc(slice("month")).pct).toBeCloseTo(100 / 1100); // 1000 + 100
    expect(disc(slice("year")).value).toBe("R$ 200");
    expect(disc(slice("year")).pct).toBeCloseTo(200 / 1600);  // 1400 + 200
    expect(disc(slice("month")).label).toBe("Descontos");
    expect(slice("month").gauges.find((g) => g.key === "conversion")).toBeUndefined();
  });
});

describe("buildOverviewSlice — hourly granularity buckets by registration time", () => {
  // In production gestek `data` (sold_at) is date-only → local midnight, carrying no
  // time of day. The hourly chart must bucket by `created_at` (data_criacao), the real
  // wall-clock time the sale was registered. America/Sao_Paulo is UTC-3, so 09:00 local
  // == 12:00Z and 14:00 local == 17:00Z.
  const hourlySource: OverviewSource = {
    ...source,
    vendas: [
      { sold_at: "2026-06-16T03:00:00Z", created_at: "2026-06-16T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 700, valor_pago: 700, valor_desconto: 0, procedimentos: "BOTOX (1)" },
      { sold_at: "2026-06-16T03:00:00Z", created_at: "2026-06-16T17:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 250, valor_pago: 250, valor_desconto: 0, procedimentos: "BOTOX (1)" },
    ],
    nowIso: "2026-06-16T20:30:00Z", // 17:30 local
  };

  it("spreads sales across the hour they were registered, not 00h", () => {
    const { chart } = buildOverviewSlice(hourlySource, rangeForPreset(new Date(hourlySource.nowIso), "today"), "today");
    const byLabel = Object.fromEntries(chart.map((b) => [b.label, b.revenue]));
    expect(byLabel["09h"]).toBe(700);
    expect(byLabel["14h"]).toBe(250);
    expect(byLabel["00h"] ?? 0).toBe(0);
  });
});
