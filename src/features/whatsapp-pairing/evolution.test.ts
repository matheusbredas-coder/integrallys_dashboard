import { afterEach, describe, expect, test, vi } from "vitest";
import { normalizePhone, pairingFrom, requestPairing, stateFrom } from "./evolution";

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

describe("requestPairing", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

  function stub(bodies: unknown[]) {
    vi.stubEnv("EVOLUTION_BASE_URL", "https://evo.test");
    vi.stubEnv("EVOLUTION_API_KEY", "k");
    vi.stubEnv("EVOLUTION_INSTANCE", "Integrallys");
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return { ok: true, json: async () => bodies.shift() ?? {} };
    }));
    return urls;
  }

  test("QR request drops a pairing code Evolution sends anyway", async () => {
    stub([{ base64: "data:qr", pairingCode: "ABCD1234" }]);
    expect(await requestPairing()).toEqual({ state: "connecting", qr: "data:qr" });
  });

  test("QR request retries when Evolution answers empty", async () => {
    vi.useFakeTimers();
    stub([{ count: 0 }, { base64: "data:qr", pairingCode: null }]);
    const p = requestPairing();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ state: "connecting", qr: "data:qr" });
  });

  test("code request with a stale QR session logs out once, then gets the code", async () => {
    vi.useFakeTimers();
    const urls = stub([
      { base64: "data:qr", pairingCode: null },
      { instance: { state: "close" } },
      {},
      { base64: "data:qr", pairingCode: "ABCD1234" },
    ]);
    const p = requestPairing("5527999687380");
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ state: "connecting", pairingCode: "ABCD1234" });
    expect(urls.filter((u) => u.includes("/logout/"))).toHaveLength(1);
  });

  test("never logs out a linked phone", async () => {
    const urls = stub([{ base64: "data:qr", pairingCode: null }, { instance: { state: "open" } }]);
    expect(await requestPairing("5527999687380")).toEqual({ state: "open" });
    expect(urls.some((u) => u.includes("/logout/"))).toBe(false);
  });
});
