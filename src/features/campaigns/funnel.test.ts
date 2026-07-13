import { describe, expect, test } from "vitest";
import { defaultReactivationFunnel, resolveTrackSequence } from "./funnel";

describe("defaultReactivationFunnel", () => {
  test("has opener (id 0) + 6 follow-ups on the ~21-day cadence", () => {
    expect(defaultReactivationFunnel.steps.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(defaultReactivationFunnel.steps.map((s) => s.delayDays)).toEqual([0, 3, 6, 10, 14, 18, 21]);
  });
  test("resumePolicy is restart", () => expect(defaultReactivationFunnel.resumePolicy).toBe("restart"));
  test("last step is terminal", () => expect(defaultReactivationFunnel.steps.at(-1)!.terminal).toBe(true));
});

describe("resolveTrackSequence", () => {
  test("rosto opener uses the retoque line", () => {
    const seq = resolveTrackSequence(defaultReactivationFunnel, "rosto");
    expect(seq[0].messages[0].text).toContain("retoque");
    expect(seq[0].messages[0].text).not.toContain("continuidade");
  });
  test("medidas opener uses the continuidade line", () => {
    const seq = resolveTrackSequence(defaultReactivationFunnel, "medidas");
    expect(seq[0].messages[0].text).toContain("continuidade");
  });
  test("medidas step 4 names redução de medidas, not protocolo de rosto", () => {
    const seq = resolveTrackSequence(defaultReactivationFunnel, "medidas");
    const step4 = seq.find((s) => s.id === 4)!;
    expect(step4.messages[0].text).toContain("redução de medidas");
  });
  test("shared step 1 is identical across tracks", () => {
    const r = resolveTrackSequence(defaultReactivationFunnel, "rosto").find((s) => s.id === 1)!;
    const m = resolveTrackSequence(defaultReactivationFunnel, "medidas").find((s) => s.id === 1)!;
    expect(r.messages).toEqual(m.messages);
  });
  test("returns 7 steps ordered by delayDays", () => {
    const seq = resolveTrackSequence(defaultReactivationFunnel, "rosto");
    expect(seq.map((s) => s.delayDays)).toEqual([0, 3, 6, 10, 14, 18, 21]);
  });
});
