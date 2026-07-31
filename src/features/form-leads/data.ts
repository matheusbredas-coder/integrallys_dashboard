import "server-only";
import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { FormLeadRow } from "./types";

async function fetchFormLeads(): Promise<FormLeadRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("form_leads")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FormLeadRow[];
}

// Cache 60s (service-role client, no cookies — safe to cache). Tag 'form-leads', which the
// ingest route and the stage action both invalidate so a new or moved lead shows up at once.
export const getFormLeadsData = unstable_cache(() => fetchFormLeads(), ["form-leads-data"], {
  revalidate: 60,
  tags: ["form-leads"],
});
