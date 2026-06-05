import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAllClientes, fetchAllVendas } from "./gestek-client";

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
});

describe("fetchAllVendas", () => {
  it("sends Status=1 + date window and paginates", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page("vendas", [{ id: "v1", clienteId: "c1" }]));
    const out = await fetchAllVendas("2024-01-01", fetchMock as unknown as typeof fetch);
    expect(out).toHaveLength(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/vendas");
    expect(String(url)).toContain("Status=1");
    expect(String(url)).toContain("DataInicio=2024-01-01");
  });
});
