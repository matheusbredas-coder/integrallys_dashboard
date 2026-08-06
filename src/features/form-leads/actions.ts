"use server";

import { revalidateTag } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { enqueueStageEvent } from "@/features/capi/queue";
import { isFormLeadStage } from "./types";

// Session guard, same shape as features/campaigns/actions.ts: the service-role client
// below bypasses RLS, so every action must first prove there's a real logged-in user.
async function requireUser(): Promise<{ error: string } | null> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  return user ? null : { error: "Sessão expirada. Entre novamente." };
}

/**
 * Move a form lead to a new stage. Stages are only ever changed by hand from the Marketing
 * page — nothing automated writes this column.
 *
 * A high-intent stage (qualificado / agendado / ganho) also reports a conversion to Meta, so
 * the Leads campaign can optimize for leads that go somewhere rather than for form volume.
 * See features/capi/queue.ts.
 */
export async function updateFormLeadStage(
  id: string,
  stage: string
): Promise<{ ok: true } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  // The DB column is permissive text, so validation lives here (see FORM_LEAD_STAGES).
  if (!isFormLeadStage(stage)) return { error: "Etapa inválida." };
  if (!id) return { error: "Lead não informado." };

  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("form_leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[form-leads] stage update failed", error);
    return { error: "Não foi possível atualizar a etapa." };
  }

  // Best-effort, exactly like the Slack notification on the ingest route: the stage change is
  // already committed, and a Meta problem must not turn a successful move into an error the
  // user sees. `enqueueStageEvent` never throws; it commits the event row here and hands the
  // actual send to `after()`, so this awaits a fast INSERT and not a Meta round trip.
  const capi = await enqueueStageEvent(id, stage);
  if (capi.queued && capi.reason) {
    console.warn(`[form-leads] lead ${id} -> ${stage}: CAPI event queued (${capi.reason})`);
  }

  revalidateTag("form-leads", { expire: 0 });
  return { ok: true };
}
