import { describe, it, expect } from "vitest";
import {
  formatBRL,
  formatInt,
  parseGestekDate,
  formatDate,
  formatDateTimeBrt,
} from "./format";

describe("formatBRL", () => {
  it("formats a number as Brazilian Real", () => {
    expect(formatBRL(2500)).toBe("R$ 2.500,00");
  });
  it("handles null/empty as a dash", () => {
    expect(formatBRL(null)).toBe("—");
    expect(formatBRL("")).toBe("—");
  });
  it("parses numeric strings", () => {
    expect(formatBRL("2500.5")).toBe("R$ 2.500,50");
  });
});

describe("formatInt", () => {
  it("formats thousands", () => {
    expect(formatInt(1204)).toBe("1.204");
  });
  it("handles null", () => {
    expect(formatInt(null)).toBe("—");
  });
});

describe("parseGestekDate", () => {
  it("parses DD/MM/YY HH:MM into a Date", () => {
    const d = parseGestekDate("03/06/26 14:30");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5); // June (0-indexed)
    expect(d?.getDate()).toBe(3);
  });
  it("returns null for blanks", () => {
    expect(parseGestekDate("")).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats a Date as DD/MM/YYYY", () => {
    expect(formatDate(new Date(2026, 5, 3))).toBe("03/06/2026");
  });
});

describe("formatDateTimeBrt", () => {
  it("renders a UTC timestamp in São Paulo time", () => {
    // 17:23 UTC is 14:23 BRT (UTC-3).
    expect(formatDateTimeBrt("2026-08-05T17:23:00Z")).toBe("05/08/2026, 14:23");
  });

  it("crosses the date boundary correctly", () => {
    // 01:30 UTC on the 6th is still 22:30 on the 5th in BRT.
    expect(formatDateTimeBrt("2026-08-06T01:30:00Z")).toBe("05/08/2026, 22:30");
  });

  it("returns — for a missing or unparseable timestamp", () => {
    expect(formatDateTimeBrt(null)).toBe("—");
    expect(formatDateTimeBrt(undefined)).toBe("—");
    expect(formatDateTimeBrt("")).toBe("—");
    expect(formatDateTimeBrt("ontem à tarde")).toBe("—");
  });
});
