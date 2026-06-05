import "server-only";
import type { GestekCliente, GestekVenda } from "./types";

const BASE = "https://apipublica.gestek.com.br/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 60;

function authHeaders() {
  const token = process.env.GESTEK_API_TOKEN;
  if (!token) throw new Error("GESTEK_API_TOKEN not set");
  return { Authorization: `Bearer ${token}` };
}

function unwrap<T>(body: unknown, key: string): T[] {
  let p = body as Record<string, unknown> | unknown[];
  if (Array.isArray(p)) p = p[0] as Record<string, unknown>;
  const arr = (p as Record<string, unknown>)?.[key];
  return Array.isArray(arr) ? (arr as T[]) : [];
}

async function fetchPaged<T>(path: string, key: string, extraQuery: Record<string, string>, fetchImpl: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  for (let pageN = 1; pageN <= MAX_PAGES; pageN++) {
    const qs = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(pageN), ...extraQuery });
    const res = await fetchImpl(`${BASE}${path}?${qs.toString()}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Gestek ${path} returned ${res.status}`);
    const items = unwrap<T>(await res.json(), key);
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

export function fetchAllClientes(fetchImpl: typeof fetch = fetch): Promise<GestekCliente[]> {
  return fetchPaged<GestekCliente>("/clientes", "clientes", {}, fetchImpl);
}

export function fetchAllVendas(startISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekVenda[]> {
  const end = new Date().toISOString().slice(0, 10);
  return fetchPaged<GestekVenda>("/vendas", "vendas", { DataInicio: startISO, DataFim: end, Status: "1" }, fetchImpl);
}
