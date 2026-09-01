import { describe, expect, it } from "vitest";
import { boardColumnFor, compareForBoard, groupForBoard, visibleOnBoard } from "./board-columns";
import type { BoardColumn, FormLeadRow, FormLeadStage } from "./types";

function lead(over: Partial<FormLeadRow> = {}): FormLeadRow {
  return {
    id: "l1",
    source: "meta_instant_form",
    external_id: null,
    sheet_row: null,
    campaign: null,
    form_name: null,
    name: "Lenita",
    phone: "5527981820451",
    email: null,
    raw: {},
    protocolo: "emagrecimento",
    stage: "novo",
    notes: null,
    submitted_at: null,
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    board_column: null,
    call_attempts: 0,
    last_call_at: null,
    next_call_at: null,
    ...over,
  };
}

describe("boardColumnFor", () => {
  it("puts an unmarked lead in the first column", () => {
    expect(boardColumnFor(lead())).toBe("a_ligar");
  });

  it("reads the caller's own column", () => {
    for (const c of ["nao_atendeu", "retorno", "qualificado", "agendado", "removido"] as BoardColumn[]) {
      expect(boardColumnFor(lead({ board_column: c }))).toBe(c);
    }
  });

  it("never lets the funnel stage decide the column", () => {
    // The whole point of the split: the bot moving `stage` must not move a card.
    for (const s of ["contatado", "respondeu", "agendado", "ganho", "perdido"] as FormLeadStage[]) {
      expect(boardColumnFor(lead({ stage: s }))).toBe("a_ligar");
    }
    expect(boardColumnFor(lead({ stage: "perdido", board_column: "retorno" }))).toBe("retorno");
  });

  it("falls back to the first column for a value it does not know", () => {
    const legacy = lead({ board_column: "coluna_antiga" as unknown as BoardColumn });
    expect(() => boardColumnFor(legacy)).not.toThrow();
    expect(boardColumnFor(legacy)).toBe("a_ligar");
  });
});

describe("compareForBoard", () => {
  it("pins a lead who answered the bot to the top", () => {
    const answered = lead({ id: "a", stage: "respondeu", next_call_at: "2026-12-01T12:00:00Z" });
    const dueSooner = lead({ id: "b", next_call_at: "2026-09-01T12:00:00Z" });
    expect([dueSooner, answered].sort(compareForBoard).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("orders the rest by who is due soonest", () => {
    const later = lead({ id: "later", next_call_at: "2026-09-05T12:00:00Z" });
    const sooner = lead({ id: "sooner", next_call_at: "2026-09-02T12:00:00Z" });
    expect([later, sooner].sort(compareForBoard).map((r) => r.id)).toEqual(["sooner", "later"]);
  });

  it("sinks leads with no due date to the bottom", () => {
    // Three attempts spent: still on the board, but not something to do today.
    const spent = lead({ id: "spent", call_attempts: 3, next_call_at: null });
    const due = lead({ id: "due", next_call_at: "2026-09-02T12:00:00Z" });
    expect([spent, due].sort(compareForBoard).map((r) => r.id)).toEqual(["due", "spent"]);
  });
});

describe("visibleOnBoard", () => {
  const today = "2026-09-15";

  it("keeps every lead the caller is still working", () => {
    expect(visibleOnBoard(lead({ board_column: null, updated_at: "2025-01-01T00:00:00Z" }), today)).toBe(true);
    expect(visibleOnBoard(lead({ board_column: "nao_atendeu", updated_at: "2025-01-01T00:00:00Z" }), today)).toBe(true);
    expect(visibleOnBoard(lead({ board_column: "retorno", updated_at: "2025-01-01T00:00:00Z" }), today)).toBe(true);
  });

  it("keeps a recently finished lead and drops an old one", () => {
    const recent = lead({ board_column: "agendado", updated_at: "2026-09-10T00:00:00Z" });
    const old = lead({ board_column: "agendado", updated_at: "2026-08-01T00:00:00Z" });
    expect(visibleOnBoard(recent, today)).toBe(true);
    expect(visibleOnBoard(old, today)).toBe(false);
  });

  it("measures the cut from the last call when there was one", () => {
    const row = lead({
      board_column: "removido",
      last_call_at: "2026-09-14T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    expect(visibleOnBoard(row, today)).toBe(true);
  });
});

describe("groupForBoard", () => {
  it("buckets and sorts in one pass, skipping what is out of range", () => {
    const rows = [
      lead({ id: "novo1" }),
      lead({ id: "quente", stage: "respondeu" }),
      lead({ id: "tentada", board_column: "nao_atendeu", next_call_at: "2026-09-16T12:00:00Z" }),
      lead({ id: "antiga", board_column: "agendado", updated_at: "2026-01-01T00:00:00Z" }),
    ];
    const grouped = groupForBoard(rows, "2026-09-15");

    expect(grouped.get("a_ligar")?.map((r) => r.id)).toEqual(["quente", "novo1"]);
    expect(grouped.get("nao_atendeu")?.map((r) => r.id)).toEqual(["tentada"]);
    expect(grouped.get("agendado")).toBeUndefined();
  });
});
