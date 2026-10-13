import { revalidateTag } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildWhatsAppAdRow, phoneVariants, type WhatsAppAdBody } from "@/features/form-leads/whatsapp-ad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Called by the bot when someone writes in from a click-to-WhatsApp ad: puts her on the
 * caller's board, in "A ligar". See features/form-leads/whatsapp-ad.ts.
 *
 * Service-to-service, same shared secret as /api/leads/form/stage — the bot already holds it.
 *
 * NO CAPI event on insert, for the same reason the form ingest sends none: Meta already
 * counts the conversation the ad started. Later stage moves report as usual.
 */
export async function POST(req: Request) {
  const secret = process.env.CONFIRMATIONS_SHARED_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Não autorizado", { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as WhatsAppAdBody | null;
  const row = body ? buildWhatsAppAdRow(body) : null;
  if (!row) {
    return Response.json({ ok: false, error: "Telefone inválido" }, { status: 400 });
  }

  const sb = createSupabaseServiceClient();

  // She may already be on the board — from the form, or a tap on the ad last week. One
  // card per person: a second one would have the caller phone her twice.
  const { data: existing, error: readError } = await sb
    .from("form_leads")
    .select("id")
    .in("phone", phoneVariants(row.phone))
    .limit(1);
  if (readError) {
    console.error("[whatsapp-ad] lookup failed", readError);
    return Response.json({ ok: false, error: "Falha ao consultar" }, { status: 502 });
  }
  if (existing && existing.length > 0) {
    return Response.json({ ok: true, duplicate: true, id: existing[0]!.id });
  }

  const { data, error } = await sb
    .from("form_leads")
    // DO NOTHING on the same external_id: two messages racing in from the same ad tap.
    .upsert(row, { onConflict: "external_id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error("[whatsapp-ad] insert failed", error);
    return Response.json({ ok: false, error: "Falha ao gravar o lead" }, { status: 502 });
  }

  const inserted = data?.[0]?.id as string | undefined;
  if (!inserted) return Response.json({ ok: true, duplicate: true });

  revalidateTag("form-leads", { expire: 0 });
  return Response.json({ ok: true, id: inserted, duplicate: false });
}
