import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { BOT_ENABLED_KEY, botEnabledFrom } from "./value";

/** Whether the bot is switched on. A failed read shows "on" — the bot's own default. */
export async function getBotEnabled(): Promise<boolean> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("app_settings").select("value").eq("key", BOT_ENABLED_KEY).maybeSingle();
  if (error) console.error("[bot-switch] read failed", error);
  return botEnabledFrom(data);
}
