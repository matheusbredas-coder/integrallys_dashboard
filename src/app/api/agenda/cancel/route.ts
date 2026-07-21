import { cancelBooking } from "@/features/confirmations/cancel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called by the bot when a patient replies "CANCELAR" to a day-before confirmation
// message. Service-to-service call (no user session), so it authenticates with the
// same shared secret the CRM uses to call the bot's /api/confirmations/run.
export async function POST(req: Request) {
  const secret = process.env.CONFIRMATIONS_SHARED_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const agendaId = body && typeof body.agendaId === "string" ? body.agendaId : null;
  if (!agendaId) {
    return Response.json({ ok: false, message: "agendaId é obrigatório" }, { status: 400 });
  }

  const result = await cancelBooking(agendaId);
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
