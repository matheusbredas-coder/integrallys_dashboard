import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateReadonlySql } from "@/lib/sql-guard";
import { SCHEMA_DESCRIPTION } from "./schema";

const MODEL = process.env.CHAT_MODEL ?? "claude-opus-4-8";

const SYSTEM = `You are the data assistant for the Integrallys aesthetic clinic CRM. Answer questions about patients and sales by querying the database with the run_sql tool — never guess numbers.

${SCHEMA_DESCRIPTION}

How to work:
- Call run_sql with ONE read-only Postgres SELECT to get the facts you need. Aggregate in SQL; keep results small.
- If a query errors, read the error and try a corrected query (a few attempts max).
- Then answer concisely in the user's language (match Portuguese/English). Format money as "R$ 1.234,56".`;

const TOOLS: Anthropic.ToolUnion[] = [
  {
    name: "run_sql",
    description:
      "Run a single read-only Postgres SELECT against the clinic views to answer the user. Use it whenever the question is about patients, sales, revenue, procedures, or trends. Only SELECT/WITH is allowed; it runs read-only and is capped at 1000 rows.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "A single Postgres SELECT statement." } },
      required: ["query"],
    },
  },
];

async function runSql(query: string): Promise<string> {
  const v = validateReadonlySql(query);
  if (!v.ok) return JSON.stringify({ error: v.reason });
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb.rpc("run_readonly_select", { q: v.sql });
  if (error) return JSON.stringify({ error: error.message });
  const text = JSON.stringify(data ?? []);
  return text.length > 20000 ? text.slice(0, 20000) + "…(truncated)" : text;
}

export async function runChat(history: Anthropic.MessageParam[], onText: (t: string) => void): Promise<void> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [...history];

  for (let step = 0; step < 6; step++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });
    stream.on("text", (t) => onText(t));
    const msg = await stream.finalMessage();
    messages.push({ role: "assistant", content: msg.content });

    if (msg.stop_reason !== "tool_use") return;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.name === "run_sql") {
        const query = (block.input as { query?: string }).query ?? "";
        results.push({ type: "tool_result", tool_use_id: block.id, content: await runSql(query) });
      }
    }
    messages.push({ role: "user", content: results });
  }
  onText("\n\n_(Stopped after several steps — try rephrasing.)_");
}
