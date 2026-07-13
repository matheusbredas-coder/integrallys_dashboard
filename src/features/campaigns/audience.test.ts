import { describe, expect, test } from "vitest";
import { monthsBetween, matchesAudienceFilter, buildAudiencePreview, isFunnelReadyToPublish } from "./audience";
import { DEFAULT_TRACK_KEYWORDS } from "./classify";
import { defaultReactivationFunnel } from "./funnel";
import { EMPTY_AUDIENCE_FILTER, type AudienceFilter } from "./types";
import type { PatientSale } from "@/features/patients/types";

const sale = (soldAt: string, procedimentos: string, valorPago = 0): PatientSale => ({ soldAt, procedimentos, total: valorPago, valorPago });

describe("monthsBetween", () => {
  test("counts whole calendar months between two dates", () => {
    expect(monthsBetween(new Date("2025-01-15"), new Date("2025-07-01"))).toBe(6);
  });
  test("returns 0 for dates in the same month", () => {
    expect(monthsBetween(new Date("2025-01-01"), new Date("2025-01-31"))).toBe(0);
  });
});

describe("matchesAudienceFilter", () => {
  const asOf = new Date("2026-07-13");

  test("no purchase history never matches", () => {
    expect(matchesAudienceFilter([], EMPTY_AUDIENCE_FILTER, asOf)).toBe(false);
  });

  test("minMonthsSinceLastVisit excludes patients seen too recently", () => {
    const filter: AudienceFilter = { ...EMPTY_AUDIENCE_FILTER, minMonthsSinceLastVisit: 6 };
    expect(matchesAudienceFilter([sale("2026-06-01", "BOTOX (1)")], filter, asOf)).toBe(false);
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)")], filter, asOf)).toBe(true);
  });

  test("procedureKeyword requires a matching procedure somewhere in history", () => {
    const filter: AudienceFilter = { ...EMPTY_AUDIENCE_FILTER, procedureKeyword: "MONJAURO" };
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)")], filter, asOf)).toBe(false);
    expect(matchesAudienceFilter([sale("2025-01-01", "MONJAURO 5,0 MG (1)")], filter, asOf)).toBe(true);
  });

  test("minTotalSpend sums valorPago across all sales", () => {
    const filter: AudienceFilter = { ...EMPTY_AUDIENCE_FILTER, minTotalSpend: 1000 };
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)", 400), sale("2025-02-01", "BOTOX (1)", 400)], filter, asOf)).toBe(false);
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)", 600), sale("2025-02-01", "BOTOX (1)", 600)], filter, asOf)).toBe(true);
  });

  test("neverRebooked requires exactly one sale ever", () => {
    const filter: AudienceFilter = { ...EMPTY_AUDIENCE_FILTER, neverRebooked: true };
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)")], filter, asOf)).toBe(true);
    expect(matchesAudienceFilter([sale("2025-01-01", "BOTOX (1)"), sale("2025-02-01", "BOTOX (1)")], filter, asOf)).toBe(false);
  });
});

describe("buildAudiencePreview", () => {
  const asOf = new Date("2026-07-13");

  test("assigns a track per matching patient and excludes reserved patients", () => {
    const salesByPatient = {
      p1: [sale("2025-01-01", "BOTOX (1)")],
      p2: [sale("2025-01-01", "MONJAURO 5,0 MG (1)")],
      p3: [sale("2025-01-01", "LIPO DE PAPADA (1)")],
    };
    const result = buildAudiencePreview(salesByPatient, EMPTY_AUDIENCE_FILTER, DEFAULT_TRACK_KEYWORDS, asOf);
    expect(result).toEqual(expect.arrayContaining([
      { clienteId: "p1", track: "rosto" },
      { clienteId: "p2", track: "medidas" },
    ]));
    expect(result.find((m) => m.clienteId === "p3")).toBeUndefined();
    expect(result).toHaveLength(2);
  });

  test("applies the audience filter before track assignment", () => {
    const salesByPatient = { p1: [sale("2026-07-01", "BOTOX (1)")] }; // too recent for a 6-month filter
    const filter: AudienceFilter = { ...EMPTY_AUDIENCE_FILTER, minMonthsSinceLastVisit: 6 };
    expect(buildAudiencePreview(salesByPatient, filter, DEFAULT_TRACK_KEYWORDS, asOf)).toEqual([]);
  });
});

describe("isFunnelReadyToPublish", () => {
  test("false when any step is not approved (the seeded default funnel is all-draft)", () => {
    expect(isFunnelReadyToPublish(defaultReactivationFunnel)).toBe(false);
  });

  test("true when every step is approved", () => {
    const approved = { ...defaultReactivationFunnel, steps: defaultReactivationFunnel.steps.map((s) => ({ ...s, approvalStatus: "approved" as const })) };
    expect(isFunnelReadyToPublish(approved)).toBe(true);
  });
});
