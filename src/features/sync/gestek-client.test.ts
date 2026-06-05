import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllClientes, fetchAllVendas, monthlyWindows } from "./gestek-client";

const page = (key: string, items: unknown[]) =>
  new Response(JSON.stringify([{ [key]: items }]), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(() => { process.env.GESTEK_API_TOKEN = "tok"; });

describe("fetchAllClientes", () => {
  it("paginates until a page has < 100 and sends Bearer auth", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, nome: `N${i}` }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(page("clientes", full))
      .mockResolvedValueOnce(page("clientes", [{ id: "last", nome: "Z" }]));
    const out = await fetchAllClientes(fetchMock as unknown as typeof fetch);
    expect(out).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/clientes");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
  });
  it("throws on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(fetchAllClientes(fetchMock as unknown as typeof fetch)).rejects.toThrow();
  });
  it("retries on 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate", { status: 429 }))
      .mockImplementation(async () => page("clientes", [{ id: "c1", nome: "A" }]));
    const promise = fetchAllClientes(fetchMock as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    const out = await promise;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});

describe("monthlyWindows", () => {
  it("produces one <=31-day window per calendar month up to today", () => {
    const w = monthlyWindows("2025-01-01", new Date("2025-03-15T00:00:00Z"));
    expect(w).toEqual([
      { start: "2025-01-01", end: "2025-01-31" },
      { start: "2025-02-01", end: "2025-02-28" },
      { start: "2025-03-01", end: "2025-03-31" },
    ]);
  });
});

describe("fetchAllVendas", () => {
  it("windows by month, sends Status=1, and dedupes by id across windows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-15T00:00:00Z"));
    // every window returns the same venda -> deduped to 1 (fresh Response each call)
    const fetchMock = vi.fn().mockImplementation(async () => page("vendas", [{ id: "v1", clienteId: "c1" }]));
    const promise = fetchAllVendas("2025-01-01", fetchMock as unknown as typeof fetch);
    await vi.runAllTimersAsync();
    const out = await promise;
    vi.useRealTimers();
    expect(out).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBe(3); // 3 monthly windows: Jan, Feb, Mar
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/vendas");
    expect(String(url)).toContain("Status=1");
    expect(String(url)).toContain("DataInicio=2025-01-01");
    expect(String(url)).toContain("DataFim=2025-01-31");
  });
});
