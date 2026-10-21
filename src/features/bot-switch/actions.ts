"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { BOT_ENABLED_KEY } from "./value";

/** Turn the bot on or off for everyone. Same session guard as every other action here:
 *  the service-role client below bypasses RLS. */
export async function setBotEnabled(enabled: boolean): Promise<{ ok: true } | { error: string }> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };

  // app_settings is writable by service_role only (see migration 003).
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("app_settings")
    .upsert({ key: BOT_ENABLED_KEY, value: enabled ? 1 : 0 }, { onConflict: "key" });
  if (error) {
    console.error("[bot-switch] write failed", error);
    return { error: "Não foi possível mudar o bot. Tente de novo." };
  }

  console.log(`[bot-switch] bot ${enabled ? "ligado" : "desligado"} por ${user.email ?? user.id}`);
  revalidatePath("/marketing");
  return { ok: true };
}
