import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildWaMeUrl } from "@/features/wa-links/link";

export const runtime = "nodejs";
// Every hit is a distinct click that must be logged — never cache this response.
export const dynamic = "force-dynamic";

// Public click-tracking redirect: /r/<slug> logs one wa_link_clicks row and 302s to the
// real wa.me link. Excluded from the auth middleware (see src/proxy.ts) so it works from
// Instagram bios, ads, QR codes — anywhere, with no login. An unknown slug just bounces to
// the app root rather than erroring.
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const sb = createSupabaseServiceClient();

  const { data: link } = await sb
    .from("wa_links")
    .select("id, phone, message")
    .eq("slug", slug)
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  // Fire-and-forget the click insert: never make a real visitor wait on our logging, and
  // never fail the redirect if logging hiccups.
  const referer = req.headers.get("referer");
  const userAgent = req.headers.get("user-agent");
  await sb
    .from("wa_link_clicks")
    .insert({ link_id: link.id as string, referer, user_agent: userAgent })
    .then(({ error }) => {
      if (error) console.error("wa-link click log failed:", error.message);
    });

  const target = buildWaMeUrl(link.phone as string, (link.message as string) ?? "");
  return NextResponse.redirect(target, 302);
}
