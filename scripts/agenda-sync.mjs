// Standalone agenda backfill/sync — populates public.gestek_agenda from Gestek /api/agenda.
// Mirrors src/features/sync (fetchAllAgenda + mapAgendaToRow) but is self-contained so it
// runs under plain node without the Next "server-only"/path-alias machinery. Agenda only —
// never touches patients/vendas. Run:
//   set -a; . ./.env; set +a; node scripts/agenda-sync.mjs --dry   (preview, no writes)
//   set -a; . ./.env; set +a; node scripts/agenda-sync.mjs         (real upsert)
import { createClient } from "@supabase/supabase-js";

const BASE = "https://apipublica.gestek.com.br/api";
const PAGE_SIZE = 100;
const MAX_PAGES = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders() {
  const token = process.env.GESTEK_API_TOKEN;
  if (!token) throw new Error("GESTEK_API_TOKEN not set");
  return { Authorization: `Bearer ${token}` };
}

function unwrap(body, key) {
  let p = body;
  if (Array.isArray(p)) p = p[0];
  const arr = p?.[key];
  return Array.isArray(arr) ? arr : [];
}

async function fetchWithRetry(url, tries = 8) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, { headers: authHeaders() });
    if (res.status !== 429 || i >= tries) return res;
    const ra = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** i));
  }
}

async function fetchPaged(path, key, extraQuery) {
  const out = [];
  for (let pageN = 0; pageN < MAX_PAGES; pageN++) {
    const qs = new URLSearchParams({ Limit: String(PAGE_SIZE), Page: String(pageN), ...extraQuery });
    const res = await fetchWithRetry(`${BASE}${path}?${qs.toString()}`);
    if (!res.ok) throw new Error(`Gestek ${path} returned ${res.status}`);
    const items = unwrap(await res.json(), key);
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
  }
  return out;
}

// One <=31-day window per calendar month from startISO to today.
function monthlyWindows(startISO, today = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const start = new Date(startISO + "T00:00:00Z");
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = today.getUTCFullYear();
  const endM = today.getUTCMonth();
  const out = [];
  while (y < endY || (y === endY && m <= endM)) {
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push({ start: `${y}-${pad(m + 1)}-01`, end: `${y}-${pad(m + 1)}-${pad(lastDay)}` });
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}

async function fetchAllAgenda(startISO) {
  const byId = new Map();
  const windows = monthlyWindows(startISO);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (i > 0) await sleep(700);
    const items = await fetchPaged("/agenda", "agendamentos", {
      DataInicio: `${w.start}T00:00:00Z`,
      DataFim: `${w.end}T23:59:59Z`,
      Tipo: "0",
    });
    for (const a of items) if (a.id) byId.set(a.id, a);
  }
  return [...byId.values()];
}

function mapAgendaToRow(a) {
  return {
    id: a.id,
    data_inicio: a.dataAgendamentoInicio ?? "",
    pendente: a.pendente ?? true,
    cliente_nome: a.clienteNome ?? null,
    cliente_telefone: a.clienteTelefone ?? null,
    profissional_id: a.profissional?.id ?? null,
    profissional_nome: a.profissional?.nome ?? null,
    sala_nome: a.salaAtendimento?.nome ?? null,
    procedimentos: a.procedimentos ?? [],
  };
}

async function main() {
  const dry = process.argv.includes("--dry");
  const from = process.env.GESTEK_AGENDA_SYNC_FROM || "2025-06-01";
  console.log(`[agenda-sync] ${dry ? "DRY-RUN" : "REAL"} — fetching agenda from ${from} ...`);

  const agenda = await fetchAllAgenda(from);
  const rows = agenda.filter((a) => a.id).map(mapAgendaToRow);
  const realized = rows.filter((r) => r.pendente === false).length;
  const dates = rows.map((r) => r.data_inicio).filter(Boolean).sort();
  console.log(`[agenda-sync] fetched=${rows.length} realized(pendente=false)=${realized} pending=${rows.length - realized}`);
  console.log(`[agenda-sync] date range: ${dates[0]} .. ${dates[dates.length - 1]}`);
  console.log("[agenda-sync] sample:", rows.slice(0, 3).map((r) => ({ id: r.id, data_inicio: r.data_inicio, pendente: r.pendente, cliente: r.cliente_nome })));

  if (dry) {
    console.log("[agenda-sync] DRY-RUN — no writes performed.");
    return;
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const r = await sb.from("gestek_agenda").upsert(batch, { onConflict: "id" });
    if (r.error) throw r.error;
    written += batch.length;
  }
  console.log(`[agenda-sync] upserted ${written} rows into gestek_agenda.`);
}

main().catch((e) => {
  console.error("[agenda-sync] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
