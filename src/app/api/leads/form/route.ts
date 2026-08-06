import { revalidateTag } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  coerceIngestFields,
  mapSheetFields,
  resolveExternalId,
  resolveSource,
} from "@/features/form-leads/mapping";
import { notifyNewFormLead } from "@/features/form-leads/notify";
import { enqueueStageEvent } from "@/features/capi/queue";

export const runtime = "nodejs";
export const maxDuration = 30;
// Always run fresh: this is an ingest endpoint, never cacheable.
export const dynamic = "force-dynamic";

// Ingest for Meta Ads Instant Form leads. An n8n workflow watches Gmail for the "Lead Nova"
// notification email and POSTs the message here. Same Bearer-secret shape as /api/cron/* —
// there's no session on a machine-to-machine request — but its own secret, since it's a
// different caller. See docs/gmail-form-leads.md for the n8n side.
//
// Three body shapes are accepted, all resolved by `coerceIngestFields`:
//   - `{ message_id, subject, body, received_at }` — the live n8n Gmail path; the lead's
//     fields are parsed out of `body` by `parseLeadEmail`.
//   - Ottokit's flat payload (ad metadata at the top level, answers nested in `field_data`).
//     Retired 2026-08, still accepted so a replay of an old payload works.
//   - an explicit `{ fields: { label: answer } }` map — what the retired Google Sheet /
//     Apps Script poller sent, kept so a manual replay or curl test still works.

type IngestBody = {
  row?: number;
  submitted_at?: string;
  received_at?: string;
  message_id?: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
};

/**
 * Reachability probe. No-code webhook builders (Ottokit among them) GET the URL to
 * validate it when the step is saved, and a bare 405 there fails the whole workflow before
 * a single lead is ever sent.
 *
 * Deliberately unauthenticated and deliberately empty of data: `api/leads/*` bypasses the
 * session proxy (see src/proxy.ts), so this is a public endpoint. It answers "yes, I'm
 * here, POST to me" and nothing else — no lead data, no configuration, no secret.
 */
export function GET() {
  return Response.json({ ok: true, endpoint: "form-leads", accepts: "POST" });
}

/**
 * A privacy-safe sketch of a body we couldn't read: each top-level key with the *type* of
 * its value, e.g. `["data:object", "event:string"]`. Enough to tell a wrapped payload from
 * a flat one without ever echoing a lead's data back to the sender.
 */
function describeShape(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [`<${typeof body}>`];
  if (Array.isArray(body)) return [`<array:${body.length}>`];
  return Object.entries(body).map(
    ([key, value]) => `${key}:${Array.isArray(value) ? "array" : typeof value}`
  );
}

/**
 * The secret may arrive as an `Authorization: Bearer` header (preferred) or as a `secret`
 * key in the JSON body.
 *
 * The body fallback exists because Ottokit's Custom API Request step appends a newline to
 * every header value it stores, and its own HTTP client then refuses to send the request
 * ("is not valid header value") — so the header path is unusable from there. The body is
 * the better of the remaining options: a query string would put the secret into Vercel's
 * access logs and any proxy in between, while a POST body is not logged.
 *
 * The header is trimmed, since the whitespace that broke Ottokit is exactly the kind of
 * thing a sender adds by accident.
 */
function isAuthorized(req: Request, body: IngestBody): boolean {
  const secret = process.env.FORM_LEADS_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization")?.trim() === `Bearer ${secret}`) return true;
  return typeof body.secret === "string" && body.secret.trim() === secret;
}

export async function POST(req: Request) {
  // Parsed before the auth check because the body can carry the secret. An unauthorized
  // caller therefore costs us one JSON parse, which is cheap next to the alternative of
  // leaving this endpoint unreachable from Ottokit.
  let body: IngestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  if (!isAuthorized(req, body)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const fields = coerceIngestFields(body);
  if (Object.keys(fields).length === 0) {
    // Echo back the top-level *key names* so a misconfigured sender can be diagnosed from
    // its own test panel — the caller is a no-code tool whose payload shape we can't see
    // from here. Names only, never values: a lead's answers are personal data and this
    // response is rendered in a third-party UI.
    return Response.json(
      { ok: false, error: "Nenhum campo recebido", received: describeShape(body) },
      { status: 400 }
    );
  }

  const lead = mapSheetFields(fields);

  // A timestamp among the fields wins (Meta's `created_time`, or the email's own "Data de
  // envio" line). `submitted_at` is the caller's explicit fallback; `received_at` is when
  // Gmail received the notification — the closest stand-in when the email carries no date.
  const submittedAt = lead.submitted_at ?? body.submitted_at ?? body.received_at ?? null;

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("form_leads")
    .upsert(
      {
        source: resolveSource(body),
        external_id: resolveExternalId(lead.external_id, body),
        // Only the retired Sheets poller ever set this; Ottokit leads leave it null.
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
    // 5xx on purpose: it tells the caller the lead was NOT stored, so its own retry can
    // pick it up rather than dropping it silently.
    return Response.json({ ok: false, error: "Falha ao gravar o lead" }, { status: 502 });
  }

  const inserted = data?.[0]?.id as string | undefined;
  if (!inserted) {
    // Already ingested. Still a success for the caller, so a retry of a lead we already
    // hold settles instead of looping forever.
    return Response.json({ ok: true, duplicate: true });
  }

  revalidateTag("form-leads", { expire: 0 });

  // The lead's opening stage, reported to Meta's Conversions API. Their CRM integration guide
  // requires a trigger for every funnel stage "incluindo o estágio inicial do lead" — without
  // it Meta sees qualified and won leads with no denominator to read them against.
  //
  // Only on a genuine insert, never on a duplicate: the `if (!inserted)` above has already
  // returned, and `capi_events` has its own unique index behind that. Best-effort like the
  // Slack call below — the lead is recorded either way, and the cron owns the retry.
  const capi = await enqueueStageEvent(inserted, "novo");
  if (capi.queued && capi.reason) {
    console.warn(`[form-leads] lead ${inserted}: CAPI Lead event queued (${capi.reason})`);
  }

  // Slack is best-effort and must never fail this request: the lead is already safely
  // recorded, and a non-2xx would only make the caller resend a lead we have.
  //
  // Normally off — the "Lead Nova" email that triggers this ingest is itself the
  // notification, so SLACK_WEBHOOK_URL is left unset. Only log a failure when a webhook is
  // actually configured; otherwise every lead would log a false alarm.
  const slack = await notifyNewFormLead({ ...lead, submitted_at: submittedAt });
  if (!slack && process.env.SLACK_WEBHOOK_URL) {
    console.error(`[form-leads] lead ${inserted} recorded but Slack notification failed`);
  }

  return Response.json({ ok: true, id: inserted, duplicate: false, slack });
}
