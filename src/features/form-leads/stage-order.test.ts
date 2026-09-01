import { describe, expect, it } from "vitest";
import { isForwardMove } from "./stage-order";

describe("isForwardMove", () => {
  it("allows the bot's normal forward moves", () => {
    expect(isForwardMove("contatado", "novo")).toBe(true);
    expect(isForwardMove("respondeu", "contatado")).toBe(true);
    expect(isForwardMove("qualificado", "respondeu")).toBe(true);
  });

  it("refuses the regression this guard exists for", () => {
    // The live bug: a lead a human qualified in the morning replies to the bot's
    // WhatsApp in the afternoon, and pipeline.ts reports `respondeu` without
    // reading her stage first.
    expect(isForwardMove("respondeu", "qualificado")).toBe(false);
    expect(isForwardMove("respondeu", "agendado")).toBe(false);
    expect(isForwardMove("contatado", "respondeu")).toBe(false);
  });

  it("refuses a move to the stage the lead is already in", () => {
    // Re-reporting is not an advance, and must not fire a second CAPI event.
    expect(isForwardMove("contatado", "contatado")).toBe(false);
    expect(isForwardMove("respondeu", "respondeu")).toBe(false);
  });

  it("always allows agendado, even backwards from a human-set terminal stage", () => {
    // A booking in Gestek is ground truth. `perdido` is the last index, so
    // without this carve-out it would block every later bot write for the lead.
    expect(isForwardMove("agendado", "perdido")).toBe(true);
    expect(isForwardMove("agendado", "ganho")).toBe(true);
    expect(isForwardMove("agendado", "agendado")).toBe(true);
  });

  it("does not let a human-set perdido block anything else the bot reports", () => {
    // Everything except agendado stays blocked behind perdido, which is the
    // intent: only a booking overrides a human marking the lead lost.
    expect(isForwardMove("contatado", "perdido")).toBe(false);
    expect(isForwardMove("qualificado", "perdido")).toBe(false);
  });

  it("treats an unknown stage already in the DB as ordering-free", () => {
    // stageLabel() already tolerates legacy values; this must too, rather than
    // locking the lead out of every bot update.
    expect(isForwardMove("contatado", "etapa_antiga")).toBe(true);
    expect(isForwardMove("respondeu", "")).toBe(true);
  });
});
