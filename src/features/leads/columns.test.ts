import { describe, it, expect } from "vitest";
import { stageLabel, formatLeadCell } from "./columns";
import type { LeadRow } from "./types";

const row: LeadRow = {
  id: "5511999", channel: "local", name: "Ana", interest: "Botox",
  pain_point: "rugas", context: "no trabalho", funnel_stage: "qualifying",
  follow_up_step: 2, block_until: null, block_permanent: false,
  cliente_id: null, campaign: null,
  last_activity_at: "2026-07-01T12:00:00.000Z", created_at: "2026-06-30T12:00:00.000Z",
  is_blocked: false, message_count: 4, last_message: "ok", last_message_at: "2026-07-01T12:00:00.000Z",
};

describe("stageLabel", () => {
  it("maps known funnel stages to Portuguese labels", () => {
    expect(stageLabel("new")).toBe("Novo");
    expect(stageLabel("qualifying")).toBe("Qualificando");
    expect(stageLabel("opted_out")).toBe("Opt-out");
  });
  it("falls back to the raw value for unknown stages", () => {
    expect(stageLabel("weird")).toBe("weird");
  });
});

describe("formatLeadCell", () => {
  it("renders the funnel stage label", () => {
    expect(formatLeadCell(row, "funnel_stage")).toBe("Qualificando");
  });
  it("renders a blocked badge from is_blocked", () => {
    expect(formatLeadCell(row, "is_blocked")).toBe("—");
    expect(formatLeadCell({ ...row, is_blocked: true }, "is_blocked")).toBe("Bloqueado");
  });
  it("renders dates as dd/mm/yyyy", () => {
    expect(formatLeadCell(row, "last_activity_at")).toBe("01/07/2026");
  });
  it("blanks null values as a dash", () => {
    expect(formatLeadCell({ ...row, name: null }, "name")).toBe("—");
  });
});
