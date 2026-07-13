import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { CampaignRow } from "./types";

// The `campaigns` table queried below ships in migration 018_reactivation_campaigns.sql,
// which is committed in this repo but has not been applied to any live database yet —
// it depends on migration 017 (leads -> bot_leads rename) landing first, and 017 doesn't
// exist as a file here yet. This query will fail until both migrations are applied.

async function fetchCampaigns(): Promise<CampaignRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.from("campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CampaignRow[];
}

// Cache 60s, tag "campaigns" — same shape as getLeadsData/getPatientsData.
export const getCampaignsData = unstable_cache(() => fetchCampaigns(), ["campaigns-data"], {
  revalidate: 60,
  tags: ["campaigns"],
});
