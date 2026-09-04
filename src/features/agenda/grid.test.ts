import { describe, it, expect } from "vitest";
import { cellAt, halfHourRows, isBooked, rangeLabel } from "./grid";
import { BOOKING_RULES } from "./rules";
import type { AgendaBooking, AgendaDay } from "./types";

const H = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

function day(
  bookings: AgendaBooking[] = [],
  blockedStarts: number[] = [],
  openedStarts: number[] = [],
): Pick<AgendaDay, "bookings" | "blockedStarts" | "openedStarts"> {
  return { bookings, blockedStarts, openedStarts };
}

const booking = (start: string, end: string): AgendaBooking => ({ startMin: H(start), endMin: H(end) });

describe("halfHourRows", () => {
  it("draws the clinic's whole day as a fixed ladder, empty week or not", () => {
    const rows = halfHourRows([day()], BOOKING_RULES);
    // 11:30 opening through the 18:00 last booking (dayClose is 18:30, exclusive).
    expect(rows[0]).toBe(H("11:30"));
    expect(rows[rows.length - 1]).toBe(H("18:00"));
    expect(rows).toHaveLength(14);
    expect(rows.every((min, i) => i === 0 || min - rows[i - 1]! === 30)).toBe(true);
  });

  it("stretches to cover an appointment booked before the clinic's opening", () => {
    const rows = halfHourRows([day([booking("09:15", "10:00")])], BOOKING_RULES);
    expect(rows[0]).toBe(H("09:00"));
    expect(rows).toContain(H("09:30"));
  });

  it("stretches to cover a procedure running past the last bookable time", () => {
    const rows = halfHourRows([day([booking("18:00", "19:45")])], BOOKING_RULES);
    expect(rows[rows.length - 1]).toBe(H("19:30"));
  });

  it("keeps a hand-made block on screen after the clinic's hours move under it", () => {
    // A block nobody can see is a block nobody can take back off.
    const rows = halfHourRows([day([], [H("10:00")])], BOOKING_RULES);
    expect(rows[0]).toBe(H("10:00"));
  });
});

describe("cellAt", () => {
  it("paints every half hour an appointment touches, not just its start", () => {
    const d = day([booking("12:00", "13:00")]);
    expect(cellAt(d, H("12:00")).kind).toBe("busy");
    expect(cellAt(d, H("12:30")).kind).toBe("busy");
    expect(cellAt(d, H("13:00")).kind).not.toBe("busy");
  });

  it("flags the block only on the row it starts in, so it is labelled once", () => {
    const d = day([booking("12:00", "13:00")]);
    expect(cellAt(d, H("12:00"))).toMatchObject({ first: true });
    expect(cellAt(d, H("12:30"))).toMatchObject({ first: false });
  });

  it("marks an off-grid appointment busy in the row it starts inside", () => {
    // 11:45-12:30 is a real shape: staff book outside Gestek's :00/:30 grid.
    const d = day([booking("11:45", "12:30")]);
    expect(cellAt(d, H("11:30"))).toMatchObject({ kind: "busy", first: true });
    expect(cellAt(d, H("12:00")).kind).toBe("busy");
    expect(cellAt(d, H("12:30")).kind).not.toBe("busy");
  });

  it("leaves an offerable time unmarked — the grid paints occupancy, not vacancy", () => {
    const d = day();
    expect(cellAt(d, H("13:30"))).toEqual({ kind: "idle" });
  });

  it("marks a half hour the clinic closed by hand", () => {
    const d = day([], [H("15:00")]);
    expect(cellAt(d, H("15:00"))).toEqual({ kind: "blocked" });
    expect(cellAt(d, H("15:30"))).toEqual({ kind: "idle" });
  });

  it("lets a real appointment outrank a hand-made block on the same half hour", () => {
    // Otherwise clicking the cell would "unblock" a time a patient is booked into.
    const d = day([booking("12:00", "12:30")], [H("12:00")]);
    expect(cellAt(d, H("12:00")).kind).toBe("busy");
  });

  it("hands a booked half hour back out when the clinic opened it", () => {
    const d = day([booking("12:00", "13:00")], [], [H("12:30")]);
    expect(cellAt(d, H("12:00")).kind).toBe("busy");
    // Still carries the appointment's extent: the patient has not gone anywhere.
    expect(cellAt(d, H("12:30"))).toEqual({ kind: "opened", startMin: H("12:00"), endMin: H("13:00") });
  });

  it("ignores an open on a half hour that has nothing booked on it", () => {
    // Stale rows must be inert, not holes: Gestek changes under these decisions.
    expect(cellAt(day([], [], [H("15:00")]), H("15:00"))).toEqual({ kind: "idle" });
  });

  it("re-marks the rest of an appointment split by an opened half hour", () => {
    // 12:00 opened out of a 12:00-13:30 booking: 12:30 starts a new visible run and
    // must be labelled, or it reads as an empty grey cell.
    const d = day([booking("12:00", "13:30")], [], [H("12:00")]);
    expect(cellAt(d, H("12:30"))).toMatchObject({ kind: "busy", first: true });
    expect(cellAt(d, H("13:00"))).toMatchObject({ kind: "busy", first: false });
  });
});

describe("isBooked", () => {
  it("reports Gestek's own answer, under anything the clinic said", () => {
    const d = day([booking("12:00", "13:00")], [], [H("12:30")]);
    expect(isBooked(d, H("12:30"))).toBe(true);
    expect(isBooked(d, H("13:00"))).toBe(false);
  });
});

describe("rangeLabel", () => {
  it("reads as the clinic reads a diary entry", () => {
    expect(rangeLabel(H("11:45"), H("12:45"))).toBe("11:45 - 12:45");
  });
});
