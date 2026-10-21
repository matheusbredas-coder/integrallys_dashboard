import { storeFormLead } from "@/features/form-leads/ingest";
import { allowedOrigin, checkSiteLead } from "@/features/form-leads/site-lead";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * The public door for integrallysestetica.com.br: its contact form and the quiz at /avaliacao
 * post here straight from the visitor's browser. No secret — a static site can't keep one —
 * so `checkSiteLead` (site-lead.ts) decides what gets in, and only the site's own origin may
 * call it from a browser. Same insert as /api/leads/form, and likewise NO CAPI event: the
 * quiz fires the Meta Pixel `Lead` itself, only for a hot lead.
 */

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: cors(origin) });
}

export async function POST(req: Request) {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (!origin) return Response.json({ ok: false, error: "Origem não permitida" }, { status: 403 });

  const input = await req.json().catch(() => null);
  const check = checkSiteLead(input);
  if (!check.ok) {
    return Response.json({ ok: false, error: check.error }, { status: 400, headers: cors(origin) });
  }

  const res = await storeFormLead(check.body);
  // Re-wrap to add the CORS headers; without them the browser hides even a 200 from the page.
  return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...cors(origin) } });
}
