import { describe, it, expect } from "vitest";
import {
  formatBRL,
  formatInt,
  parseGestekDate,
  formatDate,
  formatDateTimeBrt,
  formatPhoneBr,
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

describe("formatPhoneBr", () => {
  it("drops the country code and formats a 9-digit mobile", () => {
    expect(formatPhoneBr("5527981820451")).toBe("27 98182-0451");
    expect(formatPhoneBr("5528999850111")).toBe("28 99985-0111");
  });

  it("formats an 8-digit landline", () => {
    expect(formatPhoneBr("552733334444")).toBe("27 3333-4444");
  });

  it("works on a number already stored without the country code", () => {
    expect(formatPhoneBr("27981820451")).toBe("27 98182-0451");
  });

  it("strips punctuation before formatting", () => {
    expect(formatPhoneBr("+55 (27) 98182-0451")).toBe("27 98182-0451");
  });

  it("returns anything unrecognizable untouched, rather than mangling it", () => {
    // Some rows were imported with phone and email swapped; those must look wrong.
    expect(formatPhoneBr("lenita@exemplo.com")).toBe("lenita@exemplo.com");
    expect(formatPhoneBr("123")).toBe("123");
  });

  it("shows a dash when there is no phone at all", () => {
    expect(formatPhoneBr(null)).toBe("—");
    expect(formatPhoneBr("")).toBe("—");
  });
});
