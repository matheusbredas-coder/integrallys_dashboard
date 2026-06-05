import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerGestekSync } from "@/features/sync/trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

export function isSyncEnabled() {
  return process.env.SYNC_ENABLED === "true";
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Safety gate: the N8N sync worker can mass-duplicate patients. Keep the
  // trigger disabled until the worker is fixed + validated. Re-enable with SYNC_ENABLED=true.
  if (!isSyncEnabled()) {
    return Response.json(
      { ok: false, code: "disabled", message: "Sync is temporarily disabled." },
      { status: 503 },
    );
  }

  const result = await triggerGestekSync();
  const status = result.ok ? 200 : result.code === "not_configured" ? 503 : 502;
  return Response.json(result, { status });
}
