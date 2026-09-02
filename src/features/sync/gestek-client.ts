import "server-only";
import type { GestekCliente, GestekVenda, GestekAgenda } from "./types";

// Exported: features/agenda reads the availability grid off the same host.
export const BASE = "https://apipublica.gestek.com.br/api";
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

// Gestek's rate limit, measured live on 2026-09-02: ~30 requests per ~30s, and the
// 31st comes back a bare 429 ("Muitas requisicoes!") with no Retry-After. A tripped
// limit then refuses everything for a FULL ~30s. Both constants below come from that
// measurement — 32 requests spaced 1.1s apart ran clean, so pacing is what keeps the
// limit untripped, and the backoff is only the net underneath it.
const MIN_GAP_MS = 1100;

// Serializes the bulk readers to one request per MIN_GAP_MS. Applied in fetchPaged
// rather than in fetchWithRetry because the interactive callers (features/agenda's
// availability grid) make only a couple of calls and must stay fast.
let lastPacedAt = 0;
async function pace() {
  // Clamped both ways: the first call must not wait, and a clock that jumped (fake
  // timers between tests) must not produce an absurd sleep.
  const wait = Math.min(MIN_GAP_MS, lastPacedAt + MIN_GAP_MS - Date.now());
  if (wait > 0) await sleep(wait);
  lastPacedAt = Date.now();
}

// Fetch with retry/backoff on 429 (rate limit). Honors Retry-After when present.
// `init` lets callers set a method other than GET (e.g. DELETE for cancelAgenda);
// authHeaders() is always merged in so every call stays authenticated.
//
// The backoff has to outlast that ~30s lockout or it is worse than useless: the previous
// budget (5 tries of 500ms..8s = 15.5s total) always gave up halfway through the
// lockout and surfaced the raw 429 on the dashboard's sync button. These steps
// (2s, 4s, 8s, 10s, 10s = 34s) clear it.
export async function fetchWithRetry(url: string, fetchImpl: typeof fetch, init: RequestInit = {}, tries = 5): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetchImpl(url, { ...init, headers: { ...authHeaders(), ...(init.headers ?? {}) } });
    if (res.status !== 429 || i >= tries) return res;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(10_000, 2000 * 2 ** i));
  }
}

async function fetchPaged<T>(path: string, key: string, extraQuery: Record<string, string>, fetchImpl: typeof fetch): Promise<T[]> {
  const out: T[] = [];
  // Gestek pagination is 0-indexed: Page=0 is the first page.
  for (let pageN = 0; pageN < MAX_PAGES; pageN++) {
    const qs = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(pageN), ...extraQuery });
    await pace();
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
  for (const w of windows) {
    const items = await fetchPaged<GestekVenda>("/vendas", "vendas", { DataInicio: w.start, DataFim: w.end, Status: "1" }, fetchImpl);
    for (const v of items) if (v.id) byId.set(v.id, v);
  }
  return [...byId.values()];
}

// Agenda mirrors vendas: the date filter is capped per request, so page month-by-month
// (each calendar month is <= 31 days). Tipo=0 returns both realized (pendente=false) and
// upcoming (pendente=true) appointments; we store both.
export async function fetchAllAgenda(startISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekAgenda[]> {
  const byId = new Map<string, GestekAgenda>();
  const windows = monthlyWindows(startISO);
  for (const w of windows) {
    const items = await fetchPaged<GestekAgenda>(
      "/agenda",
      "agendamentos",
      { DataInicio: `${w.start}T00:00:00Z`, DataFim: `${w.end}T23:59:59Z`, Tipo: "0" },
      fetchImpl,
    );
    for (const a of items) if (a.id) byId.set(a.id, a);
  }
  return [...byId.values()];
}

// Fetch a single day's agenda. Used by the appointment-confirmation cron, which only
// ever needs "tomorrow" — a single day is well under the per-request date-filter cap,
// so unlike fetchAllAgenda/fetchAllVendas this doesn't need monthlyWindows(). Tipo=0
// returns both realized and upcoming appointments; the caller filters by `pendente`.
export async function fetchAgendaForDay(dayISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekAgenda[]> {
  const items = await fetchPaged<GestekAgenda>(
    "/agenda",
    "agendamentos",
    { DataInicio: `${dayISO}T00:00:00Z`, DataFim: `${dayISO}T23:59:59Z`, Tipo: "0" },
    fetchImpl,
  );
  const byId = new Map<string, GestekAgenda>();
  for (const a of items) if (a.id) byId.set(a.id, a);
  return [...byId.values()];
}

// Cancel a booking. Confirmed to exist via the Gestek Swagger UI (DELETE /api/agenda/{id},
// 200 OK) even though every other call in this client is read-only.
export async function cancelAgenda(id: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchWithRetry(`${BASE}/agenda/${id}`, fetchImpl, { method: "DELETE" });
  if (!res.ok) throw new Error(`Gestek DELETE /agenda/${id} returned ${res.status}`);
}
