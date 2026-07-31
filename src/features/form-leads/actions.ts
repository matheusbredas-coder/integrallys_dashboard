"use server";

import { revalidateTag } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
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

  revalidateTag("form-leads", { expire: 0 });
  return { ok: true };
}
