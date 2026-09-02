import { describe, it, expect } from "vitest";
import { parseAvailableSlots, parseDayBookings } from "./parse";

const PROF = "688019b1e32861b9fbbcc5a8";

describe("parseAvailableSlots", () => {
  it("reads the horarios of the requested professional", () => {
    const body = [
      { profissional: { id: PROF, nome: "DR PEDRO" }, horarios: ["12:00", "12:30", "13:00"] },
      { profissional: { id: "outro" }, horarios: ["09:00"] },
    ];
    expect(parseAvailableSlots(body, PROF)).toEqual(["12:00", "12:30", "13:00"]);
  });

  it("dedupes times two professionals both offer", () => {
    const body = [
      { profissional: { id: PROF }, horarios: ["12:00"] },
      { profissional: { id: PROF }, horarios: ["12:00", "12:30"] },
    ];
    expect(parseAvailableSlots(body, PROF)).toEqual(["12:00", "12:30"]);
  });

  it("yields nothing for Gestek's error envelope instead of throwing", () => {
    expect(parseAvailableSlots({ error: "ProcedimentosIds is required" }, PROF)).toEqual([]);
    expect(parseAvailableSlots(null, PROF)).toEqual([]);
  });
});

describe("parseDayBookings", () => {
  const body = [
    {
      agendamentos: [
        {
          id: "a1",
          dataAgendamentoInicio: "2026-09-02T15:00:00Z", // 12:00 clinic-local
          clienteNome: "SANDRA",
          procedimentos: [{ duracaoMinutos: 30 }, { duracaoMinutos: 30 }],
        },
        // The owner's own self-block: no procedures, so it carries no duration.
        { id: "a2", dataAgendamentoInicio: "2026-09-02T20:00:00Z", procedimentos: [] },
        // Malformed: no start. Anchoring the day on it would move every offer.
        { id: "a3", clienteNome: "SEM HORA" },
      ],
    },
  ];

  it("converts UTC starts to clinic-local minutes and date", () => {
    const [first] = parseDayBookings(body);
    expect(first).toMatchObject({ agendaId: "a1", dateISO: "2026-09-02", startMin: 12 * 60 });
  });

  it("keeps every procedure duration so a stacked appointment is not under-measured", () => {
    expect(parseDayBookings(body)[0]!.procedureDurations).toEqual([30, 30]);
  });

  it("drops entries with no parseable start rather than placing them at the wrong hour", () => {
    expect(parseDayBookings(body).map((b) => b.agendaId)).toEqual(["a1", "a2"]);
  });

  it("returns nothing for an unexpected body", () => {
    expect(parseDayBookings({ nope: true })).toEqual([]);
    expect(parseDayBookings("OK")).toEqual([]);
  });
});
