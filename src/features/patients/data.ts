import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Row, PatientSale } from "./types";

export async function getPatientsData(): Promise<{ patients: Row[]; salesByPatient: Record<string, PatientSale[]> }> {
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
