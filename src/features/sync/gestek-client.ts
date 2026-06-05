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

// Gestek /vendas caps the date filter at 31 days, so we page month-by-month
// from startISO to today (each calendar month is <= 31 days).
export function monthlyWindows(startISO: string, today = new Date()): { start: string; end: string }[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = new Date(startISO + "T00:00:00Z");
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = today.getUTCFullYear();
  const endM = today.getUTCMonth();
  const out: { start: string; end: string }[] = [];
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push({ start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(lastDay)}` });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

export async function fetchAllVendas(startISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekVenda[]> {
  const byId = new Map<string, GestekVenda>(); // sales can recur across windows; dedupe by id
  for (const w of monthlyWindows(startISO)) {
    const items = await fetchPaged<GestekVenda>("/vendas", "vendas", { DataInicio: w.start, DataFim: w.end, Status: "1" }, fetchImpl);
    for (const v of items) if (v.id) byId.set(v.id, v);
  }
  return [...byId.values()];
}
