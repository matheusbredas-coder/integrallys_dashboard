import { describe, it, expect } from "vitest";
import { parseGoals, DEFAULT_GOALS } from "./goals";

describe("parseGoals", () => {
  const valid = { monthly_revenue_goal: "70000", monthly_new_patient_goal: "40", avg_ticket_goal: "320" };

  it("parses a complete, valid payload into a typed Goals", () => {
    const r = parseGoals(valid);
    expect(r.error).toBeUndefined();
    expect(r.goals).toEqual({ monthly_revenue_goal: 70000, monthly_new_patient_goal: 40, avg_ticket_goal: 320 });
  });

  it("accepts decimals on revenue and a comma separator", () => {
    const r = parseGoals({ ...valid, monthly_revenue_goal: "65000,50" });
    expect(r.goals?.monthly_revenue_goal).toBe(65000.5);
  });

  it("accepts the seeded default values", () => {
    const r = parseGoals({
      monthly_revenue_goal: String(DEFAULT_GOALS.monthly_revenue_goal),
      monthly_new_patient_goal: String(DEFAULT_GOALS.monthly_new_patient_goal),
      avg_ticket_goal: String(DEFAULT_GOALS.avg_ticket_goal),
    });
    expect(r.goals).toEqual(DEFAULT_GOALS);
  });

  it("rejects an empty field", () => {
    const r = parseGoals({ ...valid, avg_ticket_goal: "  " });
    expect(r.goals).toBeUndefined();
    expect(r.error).toMatch(/Ticket médio alvo/);
  });

  it("rejects a missing field", () => {
    const r = parseGoals({ monthly_revenue_goal: "70000", avg_ticket_goal: "320" });
    expect(r.error).toMatch(/novos pacientes/);
  });

  it("rejects non-numeric input", () => {
    const r = parseGoals({ ...valid, monthly_revenue_goal: "abc" });
    expect(r.error).toMatch(/número válido/);
  });

  it("rejects negative numbers", () => {
    const r = parseGoals({ ...valid, monthly_new_patient_goal: "-5" });
    expect(r.error).toMatch(/não pode ser negativo/);
  });
});
