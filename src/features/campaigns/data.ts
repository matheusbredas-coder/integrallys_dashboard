import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { CampaignRow } from "./types";

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
