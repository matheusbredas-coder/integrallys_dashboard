import { describe, it, expect } from "vitest";
import { normalizePhone, isValidPhone, buildWaMeUrl, buildBrWaMeUrl, trackedLinkUrl, randomSlug } from "./link";

describe("normalizePhone", () => {
  it("strips punctuation, spaces and symbols", () => {
    expect(normalizePhone("+55 (41) 99999-8888")).toBe("5541999998888");
  });
  it("handles empty/nullish", () => {
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone(undefined as unknown as string)).toBe("");
  });
});

describe("isValidPhone", () => {
  it("accepts a full country-code number", () => {
    expect(isValidPhone("+55 41 99999-8888")).toBe(true);
  });
  it("rejects too short", () => {
    expect(isValidPhone("99998888")).toBe(false);
  });
  it("rejects too long (> 15 digits)", () => {
    expect(isValidPhone("1234567890123456")).toBe(false);
  });
});

describe("buildWaMeUrl", () => {
  it("builds a bare link when no message", () => {
    expect(buildWaMeUrl("+55 (41) 99999-8888")).toBe("https://wa.me/5541999998888");
  });
  it("appends a URL-encoded prefilled message", () => {
    expect(buildWaMeUrl("5541999998888", "Olá! Tudo bem?")).toBe(
      "https://wa.me/5541999998888?text=Ol%C3%A1!%20Tudo%20bem%3F",
    );
  });
  it("ignores a whitespace-only message", () => {
    expect(buildWaMeUrl("5541999998888", "   ")).toBe("https://wa.me/5541999998888");
  });
});

describe("trackedLinkUrl", () => {
  it("joins origin and slug", () => {
    expect(trackedLinkUrl("https://crm.example.com", "aB3xY9z2")).toBe("https://crm.example.com/r/aB3xY9z2");
  });
  it("tolerates a trailing slash on origin", () => {
    expect(trackedLinkUrl("https://crm.example.com/", "abc")).toBe("https://crm.example.com/r/abc");
  });
});

describe("randomSlug", () => {
  it("has the requested length and only uses the alphabet", () => {
    const slug = randomSlug(8);
    expect(slug).toHaveLength(8);
    expect(slug).toMatch(/^[0-9a-zA-Z]+$/);
  });
  it("is deterministic given an injected byte source", () => {
    const bytes = (n: number) => new Uint8Array(Array.from({ length: n }, (_, i) => i));
    // indices 0..7 map to the first 8 chars of the alphabet
    expect(randomSlug(8, bytes)).toBe("01234567");
  });
});

describe("buildBrWaMeUrl", () => {
  it("keeps a number that already carries the country code", () => {
    expect(buildBrWaMeUrl("5527992256239")).toBe("https://wa.me/5527992256239");
  });
  it("puts 55 back on a bare local number", () => {
    expect(buildBrWaMeUrl("27 99225-6239")).toBe("https://wa.me/5527992256239");
  });
  it("handles a landline-length local number", () => {
    expect(buildBrWaMeUrl("2733334444")).toBe("https://wa.me/552733334444");
  });
  it("returns null when there is nothing dialable", () => {
    expect(buildBrWaMeUrl(null)).toBeNull();
    expect(buildBrWaMeUrl("")).toBeNull();
    expect(buildBrWaMeUrl("1234")).toBeNull();
  });
});
