import { describe, expect, test } from "vitest";
import { normalizePhone, pairingFrom, stateFrom } from "./evolution";

describe("stateFrom", () => {
  test("reads the instance state", () => expect(stateFrom({ instance: { state: "close" } })).toBe("close"));
  test("anything else is unknown", () => expect(stateFrom({})).toBe("unknown"));
});

describe("pairingFrom", () => {
  test("QR and pairing code", () =>
    expect(pairingFrom({ base64: "data:image/png;base64,AA", pairingCode: "ABCD1234", code: "x" }))
      .toEqual({ state: "connecting", qr: "data:image/png;base64,AA", pairingCode: "ABCD1234" }));
  test("QR only when no number was sent", () =>
    expect(pairingFrom({ base64: "data:image/png;base64,AA", pairingCode: null }))
      .toEqual({ state: "connecting", qr: "data:image/png;base64,AA", pairingCode: undefined }));
  test("already linked", () => expect(pairingFrom({ instance: { state: "open" } })).toEqual({ state: "open" }));
});

describe("normalizePhone", () => {
  test("adds 55", () => expect(normalizePhone("(27) 99968-7380")).toBe("5527999687380"));
  test("keeps 55", () => expect(normalizePhone("+55 27 99968-7380")).toBe("5527999687380"));
  test("rejects short", () => expect(normalizePhone("99968-7380")).toBeNull());
});
