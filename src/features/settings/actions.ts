"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { parseGoals } from "./goals";

export type GoalsFormState = { ok?: true; error?: string };

export async function updateGoals(_prev: GoalsFormState, formData: FormData): Promise<GoalsFormState> {
  // Defense in depth: never let an unauthenticated request write goals, even
  // though /settings sits behind the authenticated layout.
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente para salvar." };

  const parsed = parseGoals({
    monthly_revenue_goal: formData.get("monthly_revenue_goal")?.toString(),
    monthly_new_patient_goal: formData.get("monthly_new_patient_goal")?.toString(),
    avg_ticket_goal: formData.get("avg_ticket_goal")?.toString(),
  });
  if (!parsed.goals) return { error: parsed.error };

  // app_settings is writable by service_role only (see migration 003).
  const sb = createSupabaseServiceClient();
  const rows = Object.entries(parsed.goals).map(([key, value]) => ({ key, value }));
  const { error } = await sb.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return { error: "Não foi possível salvar as metas. Tente novamente." };

  revalidatePath("/"); // Overview gauges read these goals.
  revalidatePath("/settings");
  return { ok: true };
}
