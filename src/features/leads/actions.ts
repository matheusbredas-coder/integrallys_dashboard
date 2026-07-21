"use server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { LeadMessage } from "./types";

/** Full conversation for one lead, oldest -> newest, for the drawer. */
export async function getLeadConversation(leadId: string): Promise<LeadMessage[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_lead_messages")
    .select("id, role, content, created_at")
    .eq("lead_id", leadId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []) as LeadMessage[];
}
