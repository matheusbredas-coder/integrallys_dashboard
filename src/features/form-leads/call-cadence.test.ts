import { describe, expect, it } from "vitest";
import { MAX_CALL_ATTEMPTS, nextCallAfter, normalizeCallbackAt } from "./call-cadence";

/** A BRT wall-clock moment as the UTC instant it really is (BRT is UTC-3). */
function brt(iso: string): Date {
  return new Date(`${iso}-03:00`);
}

/** Read an instant back as BRT wall clock, for readable assertions. */
function asBrt(d: Date | null): string | null {
  if (!d) return null;
  return new Date(d.getTime() - 3 * 3600_000).toISOString().replace(".000Z", "").replace("T", " ");
}

describe("nextCallAfter", () => {
  // 2026-09-01 is a Tuesday.
  it("puts the 2nd call later the same day when there is still time", () => {
    expect(asBrt(nextCallAfter(1, brt("2026-09-01T14:00:00")))).toBe("2026-09-01 16:00:00");
  });

  it("keeps the 2nd call same-day right up against the 19h cutoff", () => {
    // 17:30 + 2h would be 19:30, past closing — so it clamps to the last callable
    // slot rather than rolling to tomorrow. She arrived today; she gets two today.
    expect(asBrt(nextCallAfter(1, brt("2026-09-01T17:30:00")))).toBe("2026-09-01 18:30:00");
  });

  it("rolls the 2nd call to the next morning once the clinic has closed", () => {
    expect(asBrt(nextCallAfter(1, brt("2026-09-01T19:05:00")))).toBe("2026-09-02 09:00:00");
  });

  it("rolls a Friday-evening lead across the weekend to Monday", () => {
    // 2026-09-04 is a Friday.
    expect(asBrt(nextCallAfter(1, brt("2026-09-04T19:30:00")))).toBe("2026-09-07 09:00:00");
  });

  it("rolls a weekend arrival to Monday morning", () => {
    // 2026-09-05 is a Saturday.
    expect(asBrt(nextCallAfter(1, brt("2026-09-05T11:00:00")))).toBe("2026-09-07 09:00:00");
  });

  it("puts the 3rd call two business days out", () => {
    // Tuesday -> Thursday.
    expect(asBrt(nextCallAfter(2, brt("2026-09-01T10:00:00")))).toBe("2026-09-03 09:00:00");
  });

  it("skips the weekend when counting the two days for the 3rd call", () => {
    // Thursday + 2 business days = Monday, not Saturday.
    expect(asBrt(nextCallAfter(2, brt("2026-09-03T10:00:00")))).toBe("2026-09-07 09:00:00");
  });

  it("stops scheduling once the three attempts are spent", () => {
    expect(nextCallAfter(MAX_CALL_ATTEMPTS, brt("2026-09-01T10:00:00"))).toBeNull();
    expect(nextCallAfter(4, brt("2026-09-01T10:00:00"))).toBeNull();
  });

  it("treats a lead with no attempts yet as due now", () => {
    expect(asBrt(nextCallAfter(0, brt("2026-09-01T14:00:00")))).toBe("2026-09-01 14:00:00");
  });
});

describe("normalizeCallbackAt", () => {
  const now = brt("2026-09-01T10:00:00");

  it("keeps a callback the caller picked inside business hours", () => {
    expect(asBrt(normalizeCallbackAt(brt("2026-09-03T15:00:00").toISOString(), now)))
      .toBe("2026-09-03 15:00:00");
  });

  it("pulls a Sunday callback forward to Monday morning", () => {
    // 2026-09-06 is a Sunday.
    expect(asBrt(normalizeCallbackAt(brt("2026-09-06T14:00:00").toISOString(), now)))
      .toBe("2026-09-07 09:00:00");
  });

  it("pulls a late-night callback to the next morning", () => {
    expect(asBrt(normalizeCallbackAt(brt("2026-09-03T22:00:00").toISOString(), now)))
      .toBe("2026-09-04 09:00:00");
  });

  it("pushes an early-morning callback to opening time the same day", () => {
    expect(asBrt(normalizeCallbackAt(brt("2026-09-03T06:00:00").toISOString(), now)))
      .toBe("2026-09-03 09:00:00");
  });

  it("refuses a date in the past, a nonsense string, or one too far out", () => {
    expect(normalizeCallbackAt(brt("2026-08-30T10:00:00").toISOString(), now)).toBeNull();
    expect(normalizeCallbackAt("amanhã de manhã", now)).toBeNull();
    expect(normalizeCallbackAt("", now)).toBeNull();
    expect(normalizeCallbackAt(brt("2027-06-01T10:00:00").toISOString(), now)).toBeNull();
  });
});
