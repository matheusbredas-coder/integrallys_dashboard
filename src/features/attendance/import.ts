import "server-only";
import * as XLSX from "xlsx";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { matchKey, mapStatus, parseLocalDateTimeToUtc, type ParsedRow } from "./parse";

// The data table inside the Gestek "Relatório de Atendimentos" sheet starts at the row
// whose first cell is this header (a summary block precedes it).
const HEADER_FIRST_CELL = "Data Agendamento";

export type ImportSummary = {
  applied: boolean;        // false = dry-run preview, true = rows were written
  totalRows: number;       // data rows found in the sheet
  matched: number;         // report rows matched to a stored booking
  written: number;         // distinct bookings written (apply only)
  skippedFuture: number;   // Agendado/Confirmado — left at default
  unknownStatus: number;   // unrecognized Status labels
  unmatched: number;       // no stored booking for name + datetime
  unknownLabels: string[]; // the distinct unrecognized labels, for review
  unmatchedSamples: ParsedRow[]; // first handful of unmatched rows, for review
};

type SbClient = ReturnType<typeof createSupabaseServiceClient>;

// Extract {cliente, dateText, statusText} rows from the first sheet. Cells are read as
// formatted text (raw:false) so "Data Agendamento" comes through exactly as displayed.
export function parseWorkbook(buf: ArrayBuffer): ParsedRow[] {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const cell = (row: unknown[], i: number) => (i < 0 ? "" : String(row[i] ?? "").trim());

  const headerIdx = grid.findIndex((r) => cell(r, 0) === HEADER_FIRST_CELL);
  if (headerIdx < 0) return [];
  const header = grid[headerIdx].map((c) => String(c ?? "").trim());
  const find = (name: string) => header.findIndex((h) => h === name);
  const iData = find("Data Agendamento");
  const iCliente = find("Cliente");
  const iStatus = find("Status");
  if (iData < 0 || iCliente < 0 || iStatus < 0) return [];

  const out: ParsedRow[] = [];
  for (let r = headerIdx + 1; r < grid.length; r++) {
    const row = grid[r];
    const cliente = cell(row, iCliente);
    const dateText = cell(row, iData);
    const statusText = cell(row, iStatus);
    if (!cliente && !dateText && !statusText) continue; // blank separator row
    out.push({ cliente, dateText, statusText });
  }
  return out;
}

// Build a (normalized-name + UTC-minute) -> [agenda_id] index over all stored bookings.
async function fetchAgendaIndex(sb: SbClient): Promise<Map<string, string[]>> {
  const PAGE = 1000;
  const index = new Map<string, string[]>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("gestek_agenda").select("id, cliente_nome, data_inicio").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const a of (data ?? []) as { id: string; cliente_nome: string | null; data_inicio: string | null }[]) {
      if (!a.cliente_nome || !a.data_inicio) continue;
      const key = matchKey(a.cliente_nome, new Date(a.data_inicio));
      const arr = index.get(key);
      if (arr) arr.push(a.id);
      else index.set(key, [a.id]);
    }
    if (!data || data.length < PAGE) break;
  }
  return index;
}

// Parse → match → (optionally) upsert. With apply=false it's a pure dry run that writes nothing.
export async function runAttendanceImport(buf: ArrayBuffer, apply: boolean): Promise<ImportSummary> {
  const rows = parseWorkbook(buf);
  const sb = createSupabaseServiceClient();
  const index = await fetchAgendaIndex(sb);

  let matched = 0, skippedFuture = 0, unknownStatus = 0, unmatched = 0;
  const unknownLabels = new Set<string>();
  const unmatchedSamples: ParsedRow[] = [];
  const writes = new Map<string, "realizado" | "cancelado" | "falta">(); // agenda_id -> status (deduped)

  for (const row of rows) {
    const sm = mapStatus(row.statusText);
    if (sm.kind === "skip") { skippedFuture++; continue; }
    if (sm.kind === "unknown") { unknownStatus++; unknownLabels.add(row.statusText || "(vazio)"); continue; }
    const when = parseLocalDateTimeToUtc(row.dateText);
    if (!when) { unmatched++; if (unmatchedSamples.length < 20) unmatchedSamples.push(row); continue; }
    const ids = index.get(matchKey(row.cliente, when));
    if (!ids || ids.length === 0) { unmatched++; if (unmatchedSamples.length < 20) unmatchedSamples.push(row); continue; }
    matched++;
    for (const id of ids) writes.set(id, sm.status);
  }

  let written = 0;
  if (apply && writes.size) {
    const now = new Date().toISOString();
    const records = [...writes].map(([agenda_id, status]) => ({ agenda_id, status, source: "xlsx", updated_at: now }));
    for (let i = 0; i < records.length; i += 500) {
      const chunk = records.slice(i, i + 500);
      const { error } = await sb.from("agenda_attendance").upsert(chunk, { onConflict: "agenda_id" });
      if (error) throw new Error(error.message);
      written += chunk.length;
    }
  }

  return {
    applied: apply,
    totalRows: rows.length,
    matched,
    written,
    skippedFuture,
    unknownStatus,
    unmatched,
    unknownLabels: [...unknownLabels],
    unmatchedSamples,
  };
}
