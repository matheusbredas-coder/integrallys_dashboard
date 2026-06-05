import type { GestekCliente, SupabasePatient, SyncWarning } from "./types";

export function normalizeName(s: string | null | undefined): string {
  return (s || "").trim().replace(/\s+/g, " ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export type SplitResult = {
  newGestekClients: GestekCliente[];
  existingGestekIds: string[];
  gestekIdToSupabaseId: Record<string, string>;
  supabaseNameToId: Record<string, string>;
  orphans: { id: string; Nome?: string }[];
  duplicates: SyncWarning[];
};

export function splitPatients(gestekClients: GestekCliente[], supabasePatients: SupabasePatient[]): SplitResult {
  const existing = new Set<string>();
  const gestekIdToSupabaseId: Record<string, string> = {};
  const supabaseNameToId: Record<string, string> = {};
  for (const p of supabasePatients) {
    if (p.gestek_id) { existing.add(p.gestek_id); gestekIdToSupabaseId[p.gestek_id] = p.id; }
    const nk = normalizeName(p.Nome);
    if (nk && !supabaseNameToId[nk]) supabaseNameToId[nk] = p.id;
  }

  const gestekIdSet = new Set(gestekClients.map((c) => c.id));
  const orphans = supabasePatients
    .filter((p) => p.gestek_id && !gestekIdSet.has(p.gestek_id))
    .map((p) => ({ id: p.id, Nome: p.Nome }));

  const seenName = new Set<string>();
  const duplicates: SyncWarning[] = [];
  const newGestekClients: GestekCliente[] = [];
  for (const c of gestekClients) {
    if (!c.id) continue;
    const nk = normalizeName(c.nome);
    if (nk) {
      if (seenName.has(nk)) duplicates.push({ level: "warn", message: `Nome duplicado no Gestek "${nk}" (${c.nome})` });
      else seenName.add(nk);
    }
    if (!existing.has(c.id)) newGestekClients.push(c); // match on gestek_id only
  }

  return { newGestekClients, existingGestekIds: [...existing], gestekIdToSupabaseId, supabaseNameToId, orphans, duplicates };
}
