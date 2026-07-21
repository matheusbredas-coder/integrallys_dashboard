import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { LeadRow } from "./types";

async function fetchLeads(): Promise<LeadRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_leads_view")
    .select("*")
    .order("last_activity_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LeadRow[];
}

// Cache 60s (service-role client, no cookies — safe to cache). Tag 'leads'.
export const getLeadsData = unstable_cache(() => fetchLeads(), ["leads-data"], {
  revalidate: 60,
  tags: ["leads"],
});
