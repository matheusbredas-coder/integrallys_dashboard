import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runGestekSync } from "@/features/sync/run-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export function isSyncEnabled() {
  return process.env.SYNC_ENABLED === "true";
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (!isSyncEnabled()) {
    return Response.json({ ok: false, code: "disabled", message: "Sync is temporarily disabled." }, { status: 503 });
  }

  const result = await runGestekSync({ dryRun });
  const status = result.ok ? 200 : result.code === "guard_tripped" ? 409 : 502;
  return Response.json(result, { status });
}
