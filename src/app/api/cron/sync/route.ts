import { revalidateTag } from "next/cache";
import { runGestekSync } from "@/features/sync/run-sync";

export const runtime = "nodejs";
export const maxDuration = 60;
// Always run fresh: this is a scheduled mutation, never a cached GET response.
export const dynamic = "force-dynamic";

// Nightly Gestek sync, triggered by Vercel Cron (see vercel.json). Unlike /api/sync
// (which gates on a logged-in user session), a cron invocation has no session, so it
// authenticates with the CRON_SECRET that Vercel sends as a Bearer token. The actual
// work is the same proven-safe runGestekSync — idempotent upserts + the mass-insert guard.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  if (process.env.SYNC_ENABLED !== "true") {
    return Response.json({ ok: false, code: "disabled", message: "A sincronização está desativada." }, { status: 503 });
  }

  const result = await runGestekSync({ dryRun: false });

  // The sync mutated the underlying tables, so drop the cached dashboard queries.
  // expire: 0 forces the next request to block on a fresh fetch instead of serving
  // stale-while-revalidate.
  if (result.ok) {
    revalidateTag("overview", { expire: 0 });
    revalidateTag("patients", { expire: 0 });
  }

  const status = result.ok ? 200 : result.code === "guard_tripped" ? 409 : 502;
  return Response.json(result, { status });
}
