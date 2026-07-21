import { describe, it, expect, vi } from "vitest";
import { cancelBooking } from "./cancel";

describe("cancelBooking", () => {
  it("cancels in Gestek then writes the local agenda_attendance override", async () => {
    const calls: string[] = [];
    const cancelAgenda = vi.fn(async (id: string) => { calls.push(`gestek:${id}`); });
    const writeOverride = vi.fn(async (id: string) => { calls.push(`override:${id}`); });

    const result = await cancelBooking("a1", { cancelAgenda, writeOverride });

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["gestek:a1", "override:a1"]); // Gestek first, override only after it succeeds
  });

  it("does NOT write the override when the Gestek cancel fails", async () => {
    const cancelAgenda = vi.fn(async () => { throw new Error("Gestek down"); });
    const writeOverride = vi.fn();

    const result = await cancelBooking("a1", { cancelAgenda, writeOverride });

    expect(result).toEqual({ ok: false, message: "Gestek down" });
    expect(writeOverride).not.toHaveBeenCalled();
  });
});
