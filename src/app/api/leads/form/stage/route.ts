import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { enqueueStageEvent } from "@/features/capi/queue";
import { isFormLeadStage } from "@/features/form-leads/types";
import { revalidateTag } from "next/cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the bot as it advances a form lead: contatado when it opens the
 * conversation, agendado once a booking lands in Gestek.
 *
 * The bot holds a service-role key and could write `stage` itself. It goes
 * through here instead because a stage change must also fire enqueueStageEvent,
 * which reports the funnel move to Meta's Conversions API — a direct write would
 * move the column and silently drop the conversion signal the ad campaign
 * optimizes on. Keeping one path in means the CAPI wiring can never be
 * half-applied.
 *
 * Service-to-service (no user session), so it authenticates with the same shared
 * secret as /api/agenda/cancel.
 */

/**
 * Stages the bot may set. Deliberately excludes 'perdido' and 'ganho':
 *
 *   - 'perdido' feeds Meta's optimization, and a bot that gives up after two
 *     unanswered messages would teach the campaign to chase the wrong people.
 *     Only a human marks a lead lost, from the Marketing page.
 *   - 'ganho' means the money arrived, which the bot cannot observe.
 */
const BOT_SETTABLE = new Set(["contatado", "respondeu", "qualificado", "agendado"]);

export async function POST(req: Request) {
  const secret = process.env.CONFIRMATIONS_SHARED_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const formLeadId = body && typeof body.formLeadId === "string" ? body.formLeadId : null;
  const stage = body && typeof body.stage === "string" ? body.stage : null;

  if (!formLeadId || !stage) {
    return Response.json({ ok: false, error: "formLeadId e stage são obrigatórios" }, { status: 400 });
  }
  if (!isFormLeadStage(stage) || !BOT_SETTABLE.has(stage)) {
    return Response.json({ ok: false, error: `Etapa "${stage}" não pode ser definida pelo bot.` }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("form_leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", formLeadId)
    .select("id");

  if (error) {
    console.error("[form-leads] bot stage update failed", error);
    return Response.json({ ok: false, error: "Não foi possível atualizar a etapa." }, { status: 502 });
  }
  if (!data?.[0]) {
    return Response.json({ ok: false, error: "Lead não encontrado." }, { status: 404 });
  }

  // Best-effort, exactly as in updateFormLeadStage: the stage change is already
  // committed, and a Meta problem must not turn a successful move into a failure
  // the bot then retries.
  const capi = await enqueueStageEvent(formLeadId, stage);
  if (capi.queued && capi.reason) {
    console.warn(`[form-leads] lead ${formLeadId} -> ${stage} (bot): CAPI event queued (${capi.reason})`);
  }

  revalidateTag("form-leads", { expire: 0 });
  return Response.json({ ok: true });
}
