import { storeFormLead, type IngestBody } from "@/features/form-leads/ingest";

export const runtime = "nodejs";
export const maxDuration = 30;
// Always run fresh: this is an ingest endpoint, never cacheable.
export const dynamic = "force-dynamic";

// Ingest for Meta Ads Instant Form leads. An n8n workflow watches Gmail for the "Lead Nova"
// notification email, pulls the lead's fields out of it, and POSTs them here as flat JSON.
// Same Bearer-secret shape as /api/cron/* — there's no session on a machine-to-machine
// request — but its own secret, since it's a different caller. See docs/gmail-form-leads.md.
//
// Two body shapes are accepted, both resolved by `coerceIngestFields`:
//   - a flat `{ label: answer }` object — the live n8n path. Labels are matched against
//     `ALIASES`, so `full_name` / `Nome completo` / `name` all reach the same column, and
//     anything unrecognized is still kept in `raw`. Ottokit's retired Facebook Lead Ads
//     payload is the same shape with answers nested in `field_data`, still unpacked.
//   - an explicit `{ fields: { label: answer } }` map — what the retired Google Sheet /
//     Apps Script poller sent, kept so a manual replay or curl test still works.

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

  return storeFormLead(body);
}
