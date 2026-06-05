import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { SupabasePatient, NewPatientRow, GestekVendaRow, SyncSummary, SyncWarning } from "./types";

export type SyncStore = {
  readPatients(): Promise<SupabasePatient[]>;
  insertPatients(rows: NewPatientRow[]): Promise<void>;
  upsertVendas(rows: GestekVendaRow[]): Promise<void>;
  logStart(meta: { run_id: string; started_at: string; trigger: string; mode: string }): Promise<void>;
  logComplete(run_id: string, completed_at: string, summary: SyncSummary, warnings: SyncWarning[]): Promise<void>;
  logError(run_id: string, completed_at: string, message: string): Promise<void>;
};

export function createSyncStore(): SyncStore {
  const sb = createSupabaseServiceClient();
  return {
    async readPatients() {
      const r = await sb.from("Clientes").select("id, Nome, gestek_id");
      if (r.error) throw r.error;
      return (r.data ?? []) as SupabasePatient[];
    },
    async insertPatients(rows) {
      if (!rows.length) return;
      const r = await sb.from("Clientes").insert(rows);
      if (r.error) throw r.error;
    },
    async upsertVendas(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        const r = await sb.from("gestek_vendas").upsert(rows.slice(i, i + 500), { onConflict: "id" });
        if (r.error) throw r.error;
      }
    },
    async logStart(meta) {
      const r = await sb.from("gestek_sync_logs").insert({ ...meta });
      if (r.error) console.warn("sync logStart failed:", r.error.message);
    },
    async logComplete(run_id, completed_at, summary, warnings) {
      const r = await sb.from("gestek_sync_logs").update({ completed_at, summary, warnings }).eq("run_id", run_id);
      if (r.error) console.warn("sync logComplete failed:", r.error.message);
    },
    async logError(run_id, completed_at, message) {
      const r = await sb.from("gestek_sync_logs").update({ completed_at, error: message }).eq("run_id", run_id);
      if (r.error) console.warn("sync logError failed:", r.error.message);
    },
  };
}
