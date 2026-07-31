import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { WaLinkRow } from "./types";

async function fetchWaLinks(): Promise<WaLinkRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("wa_links_view")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WaLinkRow[];
}

// Cache 60s, tag "wa-links" — same shape as getLeadsData/getCampaignsData so click
// counts refresh on the same cadence as the rest of the dashboard (60s window, plus the
// sync button / nightly cron sweep that revalidates this tag).
export const getWaLinksData = unstable_cache(() => fetchWaLinks(), ["wa-links-data"], {
  revalidate: 60,
  tags: ["wa-links"],
});
