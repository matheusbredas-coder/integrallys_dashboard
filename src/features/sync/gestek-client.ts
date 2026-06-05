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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch with retry/backoff on 429 (rate limit). Honors Retry-After when present.
async function fetchWithRetry(url: string, fetchImpl: typeof fetch, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetchImpl(url, { headers: authHeaders() });
    if (res.status !== 429 || i >= tries) return res;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(8000, 500 * 2 ** i));
  }
}

async function fetchPaged<T>(path: string, key: string, extraQuery: Record<string, string>, fetchImpl: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  // Gestek pagination is 0-indexed: Page=0 is the first page.
  for (let pageN = 0; pageN < MAX_PAGES; pageN++) {
    const qs = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(pageN), ...extraQuery });
    const res = await fetchWithRetry(`${BASE}${path}?${qs.toString()}`, fetchImpl);
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
  const windows = monthlyWindows(startISO);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (i > 0) await sleep(250); // throttle to stay under the rate limit
    const items = await fetchPaged<GestekVenda>("/vendas", "vendas", { DataInicio: w.start, DataFim: w.end, Status: "1" }, fetchImpl);
    for (const v of items) if (v.id) byId.set(v.id, v);
  }
  return [...byId.values()];
}
