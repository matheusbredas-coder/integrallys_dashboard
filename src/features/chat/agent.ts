import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { validateReadonlySql } from "@/lib/sql-guard";
import { SCHEMA_DESCRIPTION } from "./schema";

const MODEL = process.env.CHAT_MODEL ?? "claude-opus-4-8";

const SYSTEM = `Você é o assistente de dados do CRM da clínica de estética Integrallys. Responda perguntas sobre pacientes e vendas consultando o banco de dados com a ferramenta run_sql — nunca chute números.

${SCHEMA_DESCRIPTION}

Como trabalhar:
- Chame run_sql com UM SELECT somente leitura do Postgres para obter os fatos necessários. Agregue no SQL; mantenha os resultados pequenos.
- Se uma consulta falhar, leia o erro e tente uma consulta corrigida (no máximo algumas tentativas).
- Depois responda de forma concisa em português (pt-BR). Formate dinheiro como "R$ 1.234,56".`;

const TOOLS: Anthropic.ToolUnion[] = [
  {
    name: "run_sql",
    description:
      "Execute uma única consulta SELECT somente leitura nas views da clínica para responder ao usuário. Use sempre que a pergunta for sobre pacientes, vendas, receita, procedimentos ou tendências. Apenas SELECT/WITH é permitido; a consulta é somente leitura e tem limite de 1000 linhas.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Uma única instrução SELECT do Postgres." } },
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
  onText("\n\n_(Interrompido após algumas etapas — tente reformular.)_");
}
