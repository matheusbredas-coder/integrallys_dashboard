import "server-only";
import { randomUUID } from "node:crypto";
import type { GestekCliente, GestekVenda, NewPatientRow, SyncResult, SyncSummary, SyncWarning } from "./types";
import type { SyncStore } from "./store";
import { splitPatients, normalizeName } from "./match";
import { mapVendaToRow } from "./sales";
import { createSyncStore } from "./store";
import { fetchAllClientes, fetchAllVendas } from "./gestek-client";

export type GestekApi = {
  fetchAllClientes: () => Promise<GestekCliente[]>;
  fetchAllVendas: (startISO: string) => Promise<GestekVenda[]>;
};
export type RunDeps = { store: SyncStore; gestek: GestekApi; now?: () => Date };

// BRT-formatted "DD/MM/YY HH:MM" for the Clientes "Data do Cadastro" text column.
function fmtCadastro(dataCriacao?: string): string {
  const d = dataCriacao ? new Date(dataCriacao) : new Date();
  const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(brt.getUTCDate())}/${p(brt.getUTCMonth() + 1)}/${p(brt.getUTCFullYear() % 100)} ${p(brt.getUTCHours())}:${p(brt.getUTCMinutes())}`;
}

export async function runGestekSync(opts: { dryRun?: boolean }, deps?: RunDeps): Promise<SyncResult> {
  const store = deps?.store ?? createSyncStore();
  const gestek = deps?.gestek ?? { fetchAllClientes, fetchAllVendas: (s: string) => fetchAllVendas(s) };
  const now = deps?.now ?? (() => new Date());
  const dryRun = !!opts.dryRun;

  const run_id = randomUUID();
  const started_at = now().toISOString();
  let clientes: GestekCliente[];
  try {
    if (!dryRun) await store.logStart({ run_id, started_at, trigger: "webhook", mode: "sync" });
    clientes = await gestek.fetchAllClientes();
  } catch (e) {
    return { ok: false, code: "gestek_error", message: e instanceof Error ? e.message : "Falha ao buscar dados do Gestek." };
  }

  const patients = await store.readPatients();
  const split = splitPatients(clientes, patients);

  // Safety: never auto-create a patient whose name already exists in Supabase (prevents
  // duplicating people who exist twice in Gestek, e.g. the known LAIZA/VINICIUS records).
  // Such collisions become warnings for manual review instead of inserts.
  const warnings: SyncWarning[] = [...split.duplicates];
  const newClients = split.newGestekClients.filter((c) => {
    const collide = split.supabaseNameToId[normalizeName(c.nome)];
    if (collide) {
      warnings.push({ level: "warn", message: `Inserção ignorada: "${c.nome}" já existe no Supabase (id ${collide}); o Gestek tem um registro duplicado (${c.id})` });
      return false;
    }
    return true;
  });

  // Safety guard: never mass-insert (the prior n8n incident). Only applies once we already have data.
  const limit = Math.max(15, Math.round(patients.length * 0.15));
  if (patients.length >= 50 && newClients.length > limit) {
    const completed_at = now().toISOString();
    if (!dryRun) await store.logError(run_id, completed_at, `guard: ${newClients.length} new > ${limit}`);
    return {
      ok: false, code: "guard_tripped",
      message: `Interrompido: ${newClients.length} novos pacientes excedem o limite seguro de ${limit}. O pareamento pode estar quebrado — nada foi gravado.`,
      summary: { run_id, dryRun, total_clientes: clientes.length, patients_inserted: newClients.length },
    };
  }

  const newRows: NewPatientRow[] = newClients.map((c: GestekCliente) => ({
    id: c.id, gestek_id: c.id, Nome: c.nome ?? "", "Data do Cadastro": fmtCadastro(c.dataCriacao),
  }));

  // gestek_id -> Supabase id, including patients we'll insert (id === gestek_id for new rows)
  const idMap: Record<string, string> = { ...split.gestekIdToSupabaseId };
  for (const r of newRows) idMap[r.gestek_id] = r.id;

  // Fetch Gestek data before any write, so a fetch error never leaves partial data.
  // Only the recent N months of vendas (historical sales already live in gestek_vendas);
  // keeps us well under the Gestek rate limit. Idempotent upsert merges them in.
  const months = Math.max(1, Number(process.env.GESTEK_SYNC_MONTHS || 3));
  const sd = new Date(now());
  sd.setUTCMonth(sd.getUTCMonth() - (months - 1));
  const startISO = `${sd.getUTCFullYear()}-${String(sd.getUTCMonth() + 1).padStart(2, "0")}-01`;
  let vendas: GestekVenda[];
  try {
    vendas = await gestek.fetchAllVendas(startISO);
  } catch (e) {
    if (!dryRun) await store.logError(run_id, now().toISOString(), e instanceof Error ? e.message : "falha ao buscar vendas");
    return { ok: false, code: "gestek_error", message: e instanceof Error ? e.message : "Falha ao buscar vendas do Gestek." };
  }
  const vendaRows = vendas.filter((v) => v.id).map((v) => mapVendaToRow(v, idMap, split.supabaseNameToId));

  if (!dryRun) {
    await store.insertPatients(newRows);
    await store.upsertVendas(vendaRows);
  }

  const completed_at = now().toISOString();
  const summary: SyncSummary = {
    run_id, mode: "sync", dryRun, started_at, completed_at,
    total_clientes: clientes.length, patients_inserted: newRows.length, vendas_upserted: vendaRows.length,
    orphan_supabase_patients: split.orphans.length, duplicate_name_warnings: warnings.length,
  };
  if (!dryRun) await store.logComplete(run_id, completed_at, summary, warnings);
  return { ok: true, summary, warnings };
}
