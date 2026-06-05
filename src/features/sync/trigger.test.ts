import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerGestekSync, normalizeSyncBody } from "./trigger";

const SAMPLE = {
  summary: { mode: "sync", patients_updated: 271, new_patients_inserted: 0, total_sales_aggregated: 838, completed_at: "2026-06-04T00:00:00Z" },
  warnings: [{ level: "warn", message: "x" }],
};

describe("normalizeSyncBody", () => {
  it("unwraps a {summary, warnings} envelope", () => {
    const r = normalizeSyncBody(SAMPLE);
    expect(r).toEqual({ ok: true, summary: SAMPLE.summary, warnings: SAMPLE.warnings });
  });
  it("treats a bare summary object as the summary", () => {
    const r = normalizeSyncBody(SAMPLE.summary);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.summary).toEqual(SAMPLE.summary); expect(r.warnings).toEqual([]); }
  });
  it("returns null summary for non-object bodies", () => {
    const r = normalizeSyncBody("nope");
    expect(r).toEqual({ ok: true, summary: null, warnings: [] });
  });
});

describe("triggerGestekSync", () => {
  beforeEach(() => { process.env.N8N_SYNC_WEBHOOK_URL = "https://n8n.example/webhook/gestek-sync"; process.env.N8N_SYNC_TOKEN = "tok123"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns not_configured when URL missing", async () => {
    process.env.N8N_SYNC_WEBHOOK_URL = "";
    const r = await triggerGestekSync();
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("returns not_configured when token missing", async () => {
    process.env.N8N_SYNC_TOKEN = "";
    const r = await triggerGestekSync();
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("sends X-Sync-Token header and normalizes a happy response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200, headers: { "Content-Type": "application/json" } }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://n8n.example/webhook/gestek-sync");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "X-Sync-Token": "tok123" });
    expect(r).toMatchObject({ ok: true, summary: SAMPLE.summary });
  });
  it("maps a non-2xx webhook response to webhook_error", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "webhook_error", status: 500 });
  });
  it("returns ok with null summary when body is not JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, summary: null, warnings: [] });
  });
  it("maps a thrown network error to network", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "network" });
  });
  it("maps an AbortError to timeout", async () => {
    const fetchMock = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "timeout" });
  });
});
