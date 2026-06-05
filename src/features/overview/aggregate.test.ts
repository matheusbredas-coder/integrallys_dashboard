import { describe, it, expect } from "vitest";
import { computeOverview } from "./aggregate";
import type { VendaRow, ClienteRow, Goals, AgendaRow } from "./types";

const goals: Goals = { monthly_revenue_goal: 1000, monthly_new_patient_goal: 4, avg_ticket_goal: 100 };
const vendas: VendaRow[] = [
  { sold_at: "2026-05-02T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 300, valor_pago: 300, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-05-20T12:00:00Z", cliente_supabase_id: "1", cliente_nome: "ANA", total: 200, valor_pago: 150, procedimentos: "BOTOX (1)" },
  { sold_at: "2026-06-01T12:00:00Z", cliente_supabase_id: "2", cliente_nome: "BIA", total: 500, valor_pago: 500, procedimentos: "MONJAURO 2,5 MG (2)" },
];
const clientes: ClienteRow[] = [
  { id: "1", cadastro_at: "2026-05-01T00:00:00Z", numero_vendas: 2 },
  { id: "2", cadastro_at: "2026-06-01T00:00:00Z", numero_vendas: 1 },
  { id: "3", cadastro_at: "2026-06-02T00:00:00Z", numero_vendas: 0 },
];
const NOW = new Date("2026-06-15T00:00:00Z");

describe("computeOverview", () => {
  const d = computeOverview(vendas, clientes, goals, NOW);
  it("computes KPIs", () => {
    expect(d.kpi.revenueBilled).toBe(1000);
    expect(d.kpi.revenueCollected).toBe(950);
    expect(d.kpi.outstanding).toBe(50);
    expect(d.kpi.patients).toBe(3);
    expect(d.kpi.buyers).toBe(2);
    expect(d.kpi.sales).toBe(3);
    expect(d.kpi.avgTicket).toBeCloseTo(1000 / 3);
  });
  it("builds a sorted monthly series with new patients", () => {
    expect(d.months.map((m) => m.month)).toEqual(["2026-05", "2026-06"]);
    expect(d.months[0]).toMatchObject({ revenue: 500, sales: 2, newPatients: 1 });
    expect(d.months[1]).toMatchObject({ revenue: 500, sales: 1, newPatients: 2 });
  });
  it("gauges: revenue-this-month vs goal + conversion", () => {
    expect(d.gauges.find((g) => g.key === "revenue")!.pct).toBeCloseTo(0.5);
    expect(d.gauges.find((g) => g.key === "conversion")!.pct).toBeCloseTo(2 / 3);
  });
  it("top procedures + recent (most-recent first)", () => {
    expect(d.topProcedures[0]).toEqual({ name: "MONJAURO 2,5 MG", qty: 2 });
    expect(d.recent[0].patient).toBe("BIA");
  });
});

describe("computeOverview atendimentos", () => {
  it("counts only pendente === false across all agenda rows", () => {
    const agenda: AgendaRow[] = [
      { appointment_at: "2026-06-01T12:00:00Z", pendente: false },
      { appointment_at: "2026-06-02T12:00:00Z", pendente: false },
      { appointment_at: "2026-06-03T12:00:00Z", pendente: true },
    ];
    const out = computeOverview([], [], goals, NOW, agenda);
    expect(out.kpi.atendimentos).toBe(2);
  });

  it("defaults atendimentos to 0 when agenda is omitted", () => {
    const out = computeOverview([], [], goals, NOW);
    expect(out.kpi.atendimentos).toBe(0);
  });
});
