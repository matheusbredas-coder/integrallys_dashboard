import { drainPendingCapiEvents } from "@/features/capi/queue";

export const runtime = "nodejs";
export const maxDuration = 60;
// Always run fresh: this is a scheduled mutation (sends conversion events), never cached.
export const dynamic = "force-dynamic";

// Retry drain for the Meta Conversions API outbox, triggered by Vercel Cron (see vercel.json).
// Same CRON_SECRET auth as /api/cron/sync — a cron invocation carries no session cookie.
//
// Almost every event is already delivered inline by `after()` in enqueueStageEvent; this route
// only exists for the ones that weren't, which is why a quiet run returning zeros is the
// normal and expected outcome.
//
// Runs once a day, not every 15 minutes: the Vercel account is on the Hobby plan, which
// rejects any cron expression firing more than daily (the deploy fails outright, it does not
// degrade). That is an acceptable ceiling here — a failed event has 7 days before Meta stops
// accepting it, so a daily sweep has six days of headroom. If the plan is ever upgraded, a
// tighter schedule is a one-line change in vercel.json.
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
