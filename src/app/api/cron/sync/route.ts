import { randomUUID } from "node:crypto";
import { revalidateTag } from "next/cache";
import { runGestekSync } from "@/features/sync/run-sync";
import { createSyncStore } from "@/features/sync/store";

export const runtime = "nodejs";
export const maxDuration = 60;
// Always run fresh: this is a scheduled mutation, never a cached GET response.
export const dynamic = "force-dynamic";

// Nightly Gestek sync, triggered by Vercel Cron (see vercel.json). Unlike /api/sync
// (which gates on a logged-in user session), a cron invocation has no session, so it
// authenticates with the CRON_SECRET that Vercel sends as a Bearer token. The actual
// work is the same proven-safe runGestekSync — idempotent upserts + the mass-insert guard.
// A rejected cron must still leave a trace in gestek_sync_logs — a misconfigured
// CRON_SECRET/SYNC_ENABLED previously failed with an unlogged 401/503, and the dead
// cron went unnoticed for 18 days. Fixed messages only (the endpoint is public).
async function logCronFailure(message: string) {
  try {
    const store = createSyncStore();
    const run_id = randomUUID();
    const at = new Date().toISOString();
    await store.logStart({ run_id, started_at: at, trigger: "cron", mode: "sync" });
    await store.logError(run_id, at, message);
  } catch (e) {
    console.error("cron: falha ao registrar rejeição:", e);
  }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    await logCronFailure(!secret ? "CRON_SECRET não configurado no ambiente" : "Bearer token não confere com CRON_SECRET");
    return new Response("Não autorizado", { status: 401 });
  }

  if (process.env.SYNC_ENABLED !== "true") {
    await logCronFailure("SYNC_ENABLED não é 'true' — sincronização desativada");
    return Response.json({ ok: false, code: "disabled", message: "A sincronização está desativada." }, { status: 503 });
  }

  const result = await runGestekSync({ dryRun: false, trigger: "cron" });

  // The sync mutated the underlying tables, so drop the cached dashboard queries.
  // expire: 0 forces the next request to block on a fresh fetch instead of serving
  // stale-while-revalidate.
  if (result.ok) {
    revalidateTag("overview", { expire: 0 });
    revalidateTag("patients", { expire: 0 });
    // Refresh WhatsApp click counts on the same beat as the rest of the dashboard.
    revalidateTag("wa-links", { expire: 0 });
  }

  const status = result.ok ? 200 : result.code === "guard_tripped" ? 409 : 502;
  return Response.json(result, { status });
}
