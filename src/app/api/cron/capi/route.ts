import { drainPendingCapiEvents } from "@/features/capi/queue";

export const runtime = "nodejs";
export const maxDuration = 60;
// Always run fresh: this is a scheduled mutation (sends conversion events), never cached.
export const dynamic = "force-dynamic";

// Retry drain for the Meta Conversions API outbox, triggered by Vercel Cron (see vercel.json)
// every 15 minutes. Same CRON_SECRET auth as /api/cron/sync — a cron invocation carries no
// session cookie.
//
// Almost every event is already delivered inline by the stage-change action; this route only
// exists for the ones that weren't, which is why a quiet run returning zeros is the normal
// and expected outcome.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  if (process.env.META_CAPI_ENABLED !== "true") {
    // 503, not 200: the events are still piling up as 'pending' and someone should notice.
    return Response.json(
      { ok: false, code: "disabled", message: "Conversions API está desativada." },
      { status: 503 }
    );
  }

  const result = await drainPendingCapiEvents();
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
