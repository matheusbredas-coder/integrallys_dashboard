import "server-only";
import { cancelAgenda } from "@/features/sync/gestek-client";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export type CancelBookingResult = { ok: true } | { ok: false; message: string };

export type CancelDeps = {
  cancelAgenda?: (id: string) => Promise<void>;
  writeOverride?: (agendaId: string) => Promise<void>;
};

async function writeOverride(agendaId: string): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("agenda_attendance")
    .upsert({ agenda_id: agendaId, status: "cancelado", source: "whatsapp", updated_at: new Date().toISOString() }, { onConflict: "agenda_id" });
  if (error) throw new Error(error.message);
}

/**
 * Cancel a booking on the patient's behalf (WhatsApp "CANCELAR" reply). Cancels
 * upstream in Gestek — the clinic's own system of record — AND writes a local
 * agenda_attendance override (source='whatsapp') so the dashboard reflects it
 * immediately, mirroring the existing xlsx-import override write in
 * attendance/import.ts. If the Gestek call fails we do NOT write the override:
 * staff need to know the cancellation didn't take, not see a false "cancelado".
 */
export async function cancelBooking(agendaId: string, deps: CancelDeps = {}): Promise<CancelBookingResult> {
  const doCancel = deps.cancelAgenda ?? cancelAgenda;
  const doWriteOverride = deps.writeOverride ?? writeOverride;

  try {
    await doCancel(agendaId);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Falha ao cancelar no Gestek." };
  }

  await doWriteOverride(agendaId);
  return { ok: true };
}
