import { revalidateTag } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { mapSheetFields } from "@/features/form-leads/mapping";
import { notifyNewFormLead } from "@/features/form-leads/notify";

export const runtime = "nodejs";
export const maxDuration = 30;
// Always run fresh: this is an ingest endpoint, never cacheable.
export const dynamic = "force-dynamic";

// Ingest for Meta Ads Instant Form leads. The Google Sheet that Meta writes into has a
// bound Apps Script (scripts/apps-script/form-leads-sync.gs) that polls once a minute and
// POSTs each new row here. Same Bearer-secret shape as /api/cron/* — there's no session on
// an Apps Script request — but its own secret, since it's a different caller.

type IngestBody = {
  row?: number;
  submitted_at?: string;
  fields?: Record<string, unknown>;
};

export async function POST(req: Request) {
  const secret = process.env.FORM_LEADS_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const fields = body.fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return Response.json({ ok: false, error: "`fields` é obrigatório" }, { status: 400 });
  }

  const lead = mapSheetFields(fields as Record<string, unknown>);

  // The sheet's own timestamp column wins; body.submitted_at is the Apps Script's fallback
  // for sheets that don't have one.
  const submittedAt = lead.submitted_at ?? body.submitted_at ?? null;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("form_leads")
    .upsert(
      {
        source: "meta_instant_form",
        external_id: lead.external_id,
        sheet_row: typeof body.row === "number" ? body.row : null,
        campaign: lead.campaign,
        form_name: lead.form_name,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        raw: lead.raw,
        submitted_at: submittedAt,
      },
      // DO NOTHING on a repeated Meta lead id. `.select()` then comes back empty, which is
      // how we know not to notify again. See the index note in migration 021.
      { onConflict: "external_id", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error("[form-leads] insert failed", error);
    // 5xx on purpose: the Apps Script leaves the row unmarked and retries next minute.
    return Response.json({ ok: false, error: "Falha ao gravar o lead" }, { status: 502 });
  }

  const inserted = data?.[0]?.id as string | undefined;
  if (!inserted) {
    // Already ingested. Still a success for the caller — it should mark the row as synced
    // so it stops resending, otherwise it would retry this duplicate forever.
    return Response.json({ ok: true, duplicate: true });
  }

  revalidateTag("form-leads", { expire: 0 });

  // Slack is best-effort and must never fail this request: a non-2xx would stop the Apps
  // Script from writing its marker, and it would re-POST the same lead every minute. The
  // lead is already safely recorded either way.
  const slack = await notifyNewFormLead({ ...lead, submitted_at: submittedAt });
  if (!slack) {
    console.error(`[form-leads] lead ${inserted} recorded but Slack notification failed`);
  }

  return Response.json({ ok: true, id: inserted, duplicate: false, slack });
}
