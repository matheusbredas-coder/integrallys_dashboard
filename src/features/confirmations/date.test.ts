import { describe, it, expect } from "vitest";
import { tomorrowDayISO } from "./date";

describe("tomorrowDayISO", () => {
  it("returns tomorrow's date in BRT (UTC-3) for a midday UTC timestamp", () => {
    expect(tomorrowDayISO(new Date("2026-07-19T12:00:00Z"))).toBe("2026-07-20");
  });

  it("stays on the same BRT calendar day just before the UTC-3 midnight boundary", () => {
    // 2026-07-20T02:59:00Z is 2026-07-19T23:59 BRT — still July 19 locally.
    expect(tomorrowDayISO(new Date("2026-07-20T02:59:00Z"))).toBe("2026-07-20");
  });

  it("rolls to the next BRT calendar day right at the UTC-3 midnight boundary", () => {
    // 2026-07-20T03:00:00Z is exactly 2026-07-20T00:00 BRT.
    expect(tomorrowDayISO(new Date("2026-07-20T03:00:00Z"))).toBe("2026-07-21");
  });

  it("rolls over a month/year boundary", () => {
    expect(tomorrowDayISO(new Date("2025-12-31T12:00:00Z"))).toBe("2026-01-01");
  });
});
