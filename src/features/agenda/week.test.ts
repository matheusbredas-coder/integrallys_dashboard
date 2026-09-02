import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAgendaDay, buildAgendaWeek, mondayOfWeek, weekStartForOffset, type AgendaDeps } from "./week";
import { BOOKING_RULES } from "./rules";
import type { GestekDayBooking } from "./parse";

/** A Wednesday, clinic-local, used as "now" everywhere below. 09:00 local = 12:00Z. */
const WED = "2026-09-02";
const now = new Date("2026-09-02T12:00:00Z");

/** Gestek's real 12:00-18:30 half-hour grid. */
const GRID = ["12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00"];

function booking(startMin: number, durations: number[] = [30]): GestekDayBooking {
  return {
    agendaId: `b${startMin}`,
    startAtUtc: "2026-09-02T15:00:00Z",
    dateISO: WED,
    startMin,
    procedureDurations: durations,
    clienteNome: "FULANA",
  };
}

function deps(slots: string[] = GRID, bookings: GestekDayBooking[] = []): AgendaDeps {
  return { availableSlots: async () => slots, dayBookings: async () => bookings };
}

afterEach(() => vi.restoreAllMocks());

describe("mondayOfWeek", () => {
  it("returns the Monday of a mid-week day", () => {
    expect(mondayOfWeek("2026-09-02")).toBe("2026-08-31"); // Wednesday -> Monday
  });

  it("keeps a Monday where it is", () => {
    expect(mondayOfWeek("2026-08-31")).toBe("2026-08-31");
  });

  it("puts Sunday in the week that just ended, not the one starting tomorrow", () => {
    expect(mondayOfWeek("2026-09-06")).toBe("2026-08-31");
  });
});

describe("weekStartForOffset", () => {
  it("walks whole weeks either side of the current one", () => {
    expect(weekStartForOffset(0, now)).toBe("2026-08-31");
    expect(weekStartForOffset(1, now)).toBe("2026-09-07");
    expect(weekStartForOffset(-1, now)).toBe("2026-08-24");
  });
});

describe("buildAgendaDay", () => {
  it("offers only the times next to the day's first free slot when nothing is booked", async () => {
    const day = await buildAgendaDay(deps(), BOOKING_RULES, "2026-09-03", now);
    // maxGap 30 anchored on the first offered time: 12:00 (0 dead) and 12:30 (30 dead).
    expect(day.outcome).toBe("ok");
    expect(day.slots.map((s) => s.time)).toEqual(["12:00", "12:30"]);
  });

  it("offers the time that lands flush after an existing appointment", async () => {
    // 12:00-13:00 booked; a 30min evaluation with a 15min buffer fits from 13:15,
    // and the first grid time clearing that is 13:30.
    const day = await buildAgendaDay(deps(GRID, [booking(12 * 60, [60])]), BOOKING_RULES, "2026-09-03", now);
    expect(day.outcome).toBe("ok");
    expect(day.slots.map((s) => s.time)).toEqual(["13:30"]);
  });

  it("never offers an island hours away from the booked block", async () => {
    const day = await buildAgendaDay(deps(GRID, [booking(12 * 60, [60])]), BOOKING_RULES, "2026-09-03", now);
    expect(day.slots.map((s) => s.time)).not.toContain("17:00");
  });

  it("returns times in clock order, not in the packer's best-first order", async () => {
    // Booked 12:00-13:00 and 16:00-17:00: 13:30 (flush after the first) and 15:00
    // (flush before the second) both pack, and the packer would rank 13:30 first
    // only by luck. The table must read down the day either way.
    const day = await buildAgendaDay(
      deps(GRID, [booking(12 * 60, [60]), booking(16 * 60, [60])]),
      BOOKING_RULES,
      "2026-09-03",
      now,
    );
    const times = day.slots.map((s) => s.time);
    expect(times).toEqual([...times].sort());
  });

  it("reports the weekend as closed without calling Gestek", async () => {
    const availableSlots = vi.fn(async () => GRID);
    const day = await buildAgendaDay({ availableSlots, dayBookings: async () => [] }, BOOKING_RULES, "2026-09-05", now);
    expect(day.outcome).toBe("closed");
    expect(availableSlots).not.toHaveBeenCalled();
  });

  it("reports a configured one-off closure as closed", async () => {
    const rules = { ...BOOKING_RULES, closedDates: ["2026-09-03"] };
    const day = await buildAgendaDay(deps(), rules, "2026-09-03", now);
    expect(day.outcome).toBe("closed");
  });

  it("reports a day already gone by as past", async () => {
    const day = await buildAgendaDay(deps(), BOOKING_RULES, "2026-09-01", now);
    expect(day.outcome).toBe("past");
  });

  it("drops today's remaining times when they are inside the minimum notice", async () => {
    // Local 09:00 now; the grid starts at 12:00, so 12:00 is 3h out and survives.
    const early = await buildAgendaDay(deps(), BOOKING_RULES, WED, now);
    expect(early.outcome).toBe("ok");

    // At 11:00 local (14:00Z) the 12:00 and 12:30 offers are inside the 2h rule.
    const late = await buildAgendaDay(deps(), BOOKING_RULES, WED, new Date("2026-09-02T14:00:00Z"));
    expect(late.outcome).toBe("too-late");
    expect(late.slots).toEqual([]);
  });

  it("reports a day with no packable time as full, with the booking count", async () => {
    const solid = Array.from({ length: 8 }, (_, i) => booking(12 * 60 + i * 60, [60]));
    const day = await buildAgendaDay(deps(GRID, solid), BOOKING_RULES, "2026-09-03", now);
    expect(day.outcome).toBe("full");
    expect(day.bookedCount).toBe(8);
  });

  it("degrades one failing Gestek read to an error day instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const broken: AgendaDeps = {
      availableSlots: async () => { throw new Error("Gestek returned 500"); },
      dayBookings: async () => [],
    };
    const day = await buildAgendaDay(broken, BOOKING_RULES, "2026-09-03", now);
    expect(day.outcome).toBe("error");
    expect(day.slots).toEqual([]);
  });
});

describe("buildAgendaWeek", () => {
  it("returns only the clinic's workdays, Monday to Friday", async () => {
    const days = await buildAgendaWeek(deps(), BOOKING_RULES, "2026-08-31", now);
    expect(days.map((d) => d.dateISO)).toEqual([
      "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04",
    ]);
  });

  it("marks the days before today as past and still fills the ones ahead", async () => {
    const days = await buildAgendaWeek(deps(), BOOKING_RULES, "2026-08-31", now);
    expect(days.slice(0, 2).map((d) => d.outcome)).toEqual(["past", "past"]);
    expect(days[4]!.outcome).toBe("ok");
  });

  it("asks Gestek once per open day and never for the weekend", async () => {
    const availableSlots = vi.fn(async () => GRID);
    await buildAgendaWeek({ availableSlots, dayBookings: async () => [] }, BOOKING_RULES, "2026-09-07", now);
    expect(availableSlots).toHaveBeenCalledTimes(5);
  });
});
