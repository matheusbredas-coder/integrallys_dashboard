import { runConfirmations } from "@/features/confirmations/run-confirmations";

export const runtime = "nodejs";
export const maxDuration = 60;
// Always run fresh: this is a scheduled mutation (sends WhatsApp messages), never cached.
export const dynamic = "force-dynamic";

// Day-before appointment-confirmation send, triggered by Vercel Cron (see vercel.json) at
// 13:00 BRT (16:00 UTC). Same CRON_SECRET auth as /api/cron/sync — Vercel sends this as a
// Bearer token, there's no session on a cron invocation. Fetches tomorrow's Gestek bookings
// and hands them to the bot, which owns WhatsApp template sending (runConfirmations).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  if (process.env.CONFIRMATIONS_ENABLED !== "true") {
    return Response.json({ ok: false, code: "disabled", message: "Confirmações de agendamento estão desativadas." }, { status: 503 });
  }

  const result = await runConfirmations();
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
