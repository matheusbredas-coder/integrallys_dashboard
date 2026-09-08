import { describe, expect, it } from "vitest";
import { appendCall, callLogEntries, formatCallAt, parseCallLog } from "./call-log";
import type { FormLeadRow } from "./types";

/** A BRT wall-clock moment as the UTC instant it really is (BRT is UTC-3). */
function brt(iso: string): string {
  return new Date(`${iso}-03:00`).toISOString();
}

function row(over: Partial<FormLeadRow>): FormLeadRow {
  return {
    id: "l1", source: "meta", external_id: null, sheet_row: null, campaign: null,
    form_name: null, name: "Selma", phone: "5527999256287", email: null, raw: {},
    protocolo: "emagrecimento", stage: "novo", notes: null, submitted_at: null,
    created_at: brt("2026-09-04T09:00:00"), updated_at: brt("2026-09-04T09:00:00"),
    board_column: "nao_atendeu", call_attempts: 0, last_call_at: null, next_call_at: null,
    call_log: [],
    ...over,
  };
}

describe("parseCallLog", () => {
  it("keeps the ISO strings a jsonb array gives back", () => {
    expect(parseCallLog([brt("2026-09-04T14:32:00")])).toEqual([brt("2026-09-04T14:32:00")]);
  });

  it("survives a column that is null, junk, or holds junk", () => {
    // The DB column is permissive jsonb; nothing here may throw on screen.
    expect(parseCallLog(null)).toEqual([]);
    expect(parseCallLog("nope")).toEqual([]);
    expect(parseCallLog([42, "not a date", null])).toEqual([]);
  });
});

describe("appendCall", () => {
  it("adds the new call at the end, oldest first", () => {
    expect(appendCall([brt("2026-09-04T14:32:00")], brt("2026-09-04T16:40:00"))).toEqual([
      brt("2026-09-04T14:32:00"),
      brt("2026-09-04T16:40:00"),
    ]);
  });

  it("never grows past the three attempts the cadence allows", () => {
    const three = [brt("2026-09-04T09:00:00"), brt("2026-09-04T11:00:00"), brt("2026-09-08T09:00:00")];
    const grown = appendCall(three, brt("2026-09-09T09:00:00"));
    expect(grown).toHaveLength(3);
    // The oldest is the one dropped, so the list still ends at the newest call.
    expect(grown[2]).toBe(brt("2026-09-09T09:00:00"));
  });
});

describe("callLogEntries", () => {
  it("numbers the calls in the order they were placed", () => {
    const entries = callLogEntries(row({
      call_attempts: 2,
      call_log: [brt("2026-09-04T14:32:00"), brt("2026-09-04T16:40:00")],
    }));
    expect(entries).toEqual([
      { attempt: 1, at: brt("2026-09-04T14:32:00") },
      { attempt: 2, at: brt("2026-09-04T16:40:00") },
    ]);
  });

  it("falls back to last_call_at for a lead called before the log existed", () => {
    // Migration 030 backfills every row with an empty log, so the leads already on
    // the board have exactly one known time: the most recent call.
    expect(callLogEntries(row({
      call_attempts: 1,
      last_call_at: brt("2026-09-04T14:32:00"),
      call_log: [],
    }))).toEqual([{ attempt: 1, at: brt("2026-09-04T14:32:00") }]);
  });

  it("numbers a partial history from the end, not the start", () => {
    // One call happened before the log existed and one after: the single logged time
    // is the SECOND call, and calling it the first would misdate her history.
    expect(callLogEntries(row({
      call_attempts: 2,
      last_call_at: brt("2026-09-04T16:40:00"),
      call_log: [brt("2026-09-04T16:40:00")],
    }))).toEqual([{ attempt: 2, at: brt("2026-09-04T16:40:00") }]);
  });

  it("has nothing to show for a lead nobody has called", () => {
    expect(callLogEntries(row({ call_attempts: 0 }))).toEqual([]);
    // An attempt counted with no time anywhere is still nothing to show, not a crash.
    expect(callLogEntries(row({ call_attempts: 1, last_call_at: null }))).toEqual([]);
  });
});

describe("formatCallAt", () => {
  it("reads as the weekday, the day and the time, in Brasília", () => {
    // 2026-09-03 is a Thursday.
    expect(formatCallAt(brt("2026-09-03T14:32:00"))).toBe("qui 03/09 14:32");
  });

  it("shows the BRT day for a call made late at night", () => {
    // 22:10 BRT is already the next day in UTC — the caller's day is what matters.
    expect(formatCallAt(brt("2026-09-03T22:10:00"))).toBe("qui 03/09 22:10");
  });

  it("returns a dash rather than 'Invalid Date' for junk", () => {
    expect(formatCallAt("not a date")).toBe("—");
  });
});
