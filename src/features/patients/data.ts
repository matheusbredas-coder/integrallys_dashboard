import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Row, PatientSale } from "./types";

async function fetchPatientsData(): Promise<{ patients: Row[]; salesByPatient: Record<string, PatientSale[]> }> {
  const sb = createSupabaseServiceClient();
  const [pRes, vRes] = await Promise.all([
    sb.from("Clientes").select("*"),
    sb.from("vendas_view").select("sold_at, cliente_supabase_id, total, valor_pago, procedimentos").order("sold_at", { ascending: false }),
  ]);
  if (pRes.error) throw pRes.error;
  if (vRes.error) throw vRes.error;

  const salesByPatient: Record<string, PatientSale[]> = {};
  for (const v of vRes.data ?? []) {
    const k = String(v.cliente_supabase_id ?? "");
    if (!k) continue;
    (salesByPatient[k] ??= []).push({ soldAt: v.sold_at, total: Number(v.total) || 0, valorPago: Number(v.valor_pago) || 0, procedimentos: v.procedimentos ?? "—" });
  }
  return { patients: (pRes.data ?? []) as Row[], salesByPatient };
}

// Cache for 60s so revisiting Pacientes doesn't refetch every client + sale.
// Safe to cache: fetchPatientsData uses the service-role client (no cookies).
export const getPatientsData = unstable_cache(
  () => fetchPatientsData(),
  ["patients-data"],
  { revalidate: 60, tags: ["patients"] },
);
