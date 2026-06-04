import { createSupabaseServerClient } from "@/lib/supabase/server";
import { runChat } from "@/features/chat/agent";
import type Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  let history: Anthropic.MessageParam[] = [];
  try {
    const body = await req.json();
    history = (body.messages ?? []) as Anthropic.MessageParam[];
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        await runChat(history, (t) => controller.enqueue(encoder.encode(t)));
      } catch (e) {
        const msg = e instanceof Error ? e.message : "error";
        controller.enqueue(encoder.encode(`\n\n[Error: ${msg}]`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
