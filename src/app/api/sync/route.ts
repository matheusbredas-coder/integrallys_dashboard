import { revalidateTag } from "next/cache";
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
  if (!user) return new Response("Não autorizado", { status: 401 });

  const dryRun = new URL(req.url).searchParams.get("dryRun") === "1";
  if (!isSyncEnabled()) {
    return Response.json({ ok: false, code: "disabled", message: "A sincronização está temporariamente desativada." }, { status: 503 });
  }

  const result = await runGestekSync({ dryRun });

  // A real sync mutated the underlying tables, so drop the cached dashboard
  // queries — otherwise the client's router.refresh() re-serves stale data
  // until the 60s revalidate window elapses.
  if (result.ok && !dryRun) {
    // expire: 0 forces the next request to block on a fresh fetch instead of
    // serving stale-while-revalidate, so the client's router.refresh() lands
    // on freshly synced data rather than the previous cached copy.
    revalidateTag("overview", { expire: 0 });
    revalidateTag("patients", { expire: 0 });
    // Refresh WhatsApp click counts on the same beat as the rest of the dashboard.
    revalidateTag("wa-links", { expire: 0 });
  }

  const status = result.ok ? 200 : result.code === "guard_tripped" ? 409 : 502;
  return Response.json(result, { status });
}
