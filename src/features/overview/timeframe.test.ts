import { describe, expect, it } from "vitest";
import { buildOverviewSlice, computeReturnRate, rangeForPreset } from "./timeframe";
import type { DateRange, OverviewSource, Timeframe, VendaRow } from "./types";

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

    // Return rate is now scoped to each preset's own cohort (patients with a qualifying visit
    // inside that range), so it varies by preset instead of being constant.
    // - today (06-16..06-16): only ANA is in range; no later visit → not returning.
    // - week (06-15..06-16): ANA + BIA (06-15) in range; BIA's other visit (06-02) is BEFORE
    //   her in-range anchor (06-15), not after, so it doesn't count as "coming back".
    // - month (06-01..06-16): BIA's both visits (06-02, 06-15) fall inside the range, so her
    //   anchor is 06-02 and 06-15 is a later qualifying day → returning.
    // - year (01-01..06-16): same as month, plus CARLA (05-20) enters the cohort with no
    //   later visit of her own → not returning.
    expect(today.kpi.patientsSeen).toBe(1);
    expect(today.kpi.returningPatients).toBe(0);
    expect(week.kpi.patientsSeen).toBe(2);
    expect(week.kpi.returningPatients).toBe(0);
    expect(month.kpi.patientsSeen).toBe(2);
    expect(month.kpi.returningPatients).toBe(1);
    expect(year.kpi.patientsSeen).toBe(3);
    expect(year.kpi.returningPatients).toBe(1);
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

describe("computeReturnRate", () => {
  // Noon UTC keeps every fixture date well clear of the America/Sao_Paulo (UTC-3) day-boundary
  // shift localDateKey applies, so "same day" / "different day" here reads exactly as intended.
  // total defaults to a qualifying (paid) sale; pass 0 to simulate a package-included follow-up.
  const sale = (id: string | null, soldAt: string, total = 100): VendaRow =>
    ({ sold_at: `${soldAt}T12:00:00.000Z`, cliente_supabase_id: id, cliente_nome: null, total, valor_pago: total, valor_desconto: 0, procedimentos: null });
  const range = (start: string, end: string): DateRange =>
    ({ start: new Date(`${start}T00:00:00.000Z`), end: new Date(`${end}T23:59:59.999Z`) });
  // Wide enough to contain every fixture date used below without constraining the cohort.
  const allTime = range("2020-01-01", "2026-12-31");

  it("counts a patient with sales on two distinct days as returning", () => {
    const { patientsSeen, returningPatients } = computeReturnRate([sale("p1", "2026-01-05"), sale("p1", "2026-02-10")], allTime);
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(1);
  });

  it("does not count same-day multi-procedure sales as a return", () => {
    const { patientsSeen, returningPatients } = computeReturnRate([sale("p1", "2026-01-05"), sale("p1", "2026-01-05")], allTime);
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(0);
  });

  it("counts a single-visit patient as seen but not returning", () => {
    const { patientsSeen, returningPatients } = computeReturnRate([sale("p1", "2026-01-05")], allTime);
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(0);
  });

  it("ignores sales with no cliente_supabase_id", () => {
    const { patientsSeen, returningPatients } = computeReturnRate([sale(null, "2026-01-05"), sale(null, "2026-02-10")], allTime);
    expect(patientsSeen).toBe(0);
    expect(returningPatients).toBe(0);
  });

  it("mixes returning and one-time patients correctly", () => {
    const vendas = [
      sale("p1", "2026-01-05"), sale("p1", "2026-02-10"), // returning
      sale("p2", "2026-01-06"), // one-time
      sale("p3", "2026-01-07"), sale("p3", "2026-01-08"), sale("p3", "2026-01-09"), // returning
    ];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, allTime);
    expect(patientsSeen).toBe(3);
    expect(returningPatients).toBe(2);
  });

  it("excludes a patient whose only visit is a package-included follow-up (total=0)", () => {
    const { patientsSeen, returningPatients } = computeReturnRate([sale("p1", "2026-01-05", 0)], allTime);
    expect(patientsSeen).toBe(0);
    expect(returningPatients).toBe(0);
  });

  it("does not count a free follow-up after a paid visit as returning", () => {
    const vendas = [sale("p1", "2026-01-05", 100), sale("p1", "2026-01-20", 0)];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, allTime);
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(0);
  });

  it("still counts a return when the paying visit is bundled with a free item that same day", () => {
    // One row per sale in this codebase, so a bundled free+paid sale is a single row with total>0.
    const vendas = [sale("p1", "2026-01-05", 100), sale("p1", "2026-02-10", 150)];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, allTime);
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(1);
  });

  it("only counts patients with a qualifying visit inside the given range", () => {
    const vendas = [sale("p1", "2026-01-05"), sale("p2", "2026-06-05")];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, range("2026-01-01", "2026-01-31"));
    expect(patientsSeen).toBe(1); // only p1's January visit is in range; p2 is excluded entirely
    expect(returningPatients).toBe(0);
  });

  it("does not count a visit before the range as evidence of returning", () => {
    // p1's only in-range visit is 02-15; the 01-05 visit predates the range and is what got them
    // into the clinic, not a sign they "came back" during this period.
    const vendas = [sale("p1", "2026-01-05"), sale("p1", "2026-02-15")];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, range("2026-02-01", "2026-02-28"));
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(0);
  });

  it("counts two qualifying visits that both fall inside a wide range as returning", () => {
    const vendas = [sale("p1", "2026-01-05"), sale("p1", "2026-02-15")];
    const { patientsSeen, returningPatients } = computeReturnRate(vendas, range("2026-01-01", "2026-03-31"));
    expect(patientsSeen).toBe(1);
    expect(returningPatients).toBe(1);
  });
});
