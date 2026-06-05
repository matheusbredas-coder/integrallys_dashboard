import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerGestekSync } from "@/features/sync/trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const result = await triggerGestekSync();
  const status = result.ok ? 200 : result.code === "not_configured" ? 503 : 502;
  return Response.json(result, { status });
}
