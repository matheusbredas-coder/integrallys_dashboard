# Integrallys CRM — Plan 4: Text-to-SQL Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the Ask bar into a working "ask anything" chat that answers questions about the clinic database via **text-to-SQL** — Claude writes a SELECT, the server validates + runs it read-only, Claude summarizes the small result. Cheap, accurate, no full-table dumps.

**Architecture:** A Next.js route handler runs a Claude tool-use loop (`@anthropic-ai/sdk`, `claude-opus-4-8`, adaptive thinking, prompt-cached schema, streaming). Claude's only tool is `run_sql`. The server validates the SQL (TDD'd guard: single read-only SELECT) then executes it through a Postgres `run_readonly_select` RPC that **SET ROLEs to a SELECT-only `crm_readonly` role**, caps rows + time, and returns JSON. Two safety layers (TS guard + DB read-only role) mean a bad query can't mutate or over-read. The answer streams to a chat panel.

**Tech Stack:** Next.js 16 route handler, `@anthropic-ai/sdk` (installed), Supabase RPC via service client, Vitest.

**Builds on:** `createSupabaseServiceClient`/`createSupabaseServerClient` (Plan 1), the views from Plans 1–2, the Ask bar (Plan 2), theme tokens. `ANTHROPIC_API_KEY` is already in `.env`.

## Prerequisite — DB setup (user runs once in Supabase SQL Editor)
Creates the read-only role + guarded executor. **No password / connection string needed.** (This is migrations 005 (revised) + 008; the files are committed in Task 1, but the user applies them.)

## File structure
```
db/migrations/005_readonly_role.sql            ← REVISED: nologin role + SELECT on all views
db/migrations/008_run_readonly_select.sql      ← guarded SECURITY DEFINER executor (SET ROLE)
src/lib/sql-guard.ts                           ← validateReadonlySql (TDD)
src/lib/sql-guard.test.ts
src/features/chat/schema.ts                    ← schema description for the model
src/features/chat/agent.ts                     ← Claude tool-use loop + run_sql executor
src/app/api/chat/route.ts                      ← streaming POST endpoint (auth-gated)
src/features/chat/chat-launcher.tsx            ← Ask bar + slide-over panel (client)
src/app/(app)/page.tsx                         ← swap <AskBar/> for <ChatLauncher/>
```

---

## Task 1: DB migrations (read-only role + executor)

**Files:** Overwrite `db/migrations/005_readonly_role.sql`; create `db/migrations/008_run_readonly_select.sql`

- [ ] **Step 1: Overwrite `db/migrations/005_readonly_role.sql`**
```sql
-- SELECT-only role used (via SET ROLE) to execute AI-generated SQL. No login needed.
do $$
begin
  if not exists (select from pg_roles where rolname = 'crm_readonly') then
    create role crm_readonly nologin;
  end if;
end $$;

grant usage on schema public to crm_readonly;
grant select on
  public.clientes_view,
  public.vendas_view,
  public.vendas_monthly,
  public.procedimentos_expanded
to crm_readonly;
-- Intentionally NOT granting base tables, app_settings, metric_snapshots, or auth.
```

- [ ] **Step 2: Create `db/migrations/008_run_readonly_select.sql`**
```sql
-- Executes one AI-generated SELECT as the read-only role: read-only txn, 5s timeout,
-- 1000-row cap, returns a JSON array. Validation also happens in TypeScript first.
create or replace function public.run_readonly_select(q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare result jsonb;
begin
  set local role crm_readonly;
  set local transaction_read_only = on;
  set local statement_timeout = '5000ms';
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from (%s) _q limit 1000) t',
    q
  ) into result;
  return result;
end $$;

revoke all on function public.run_readonly_select(text) from public;
grant execute on function public.run_readonly_select(text) to service_role;
```

- [ ] **Step 3: (controller) Have the user apply both, then verify** via the service client: `sb.rpc('run_readonly_select', { q: 'select count(*) n from vendas_view' })` returns `[{n:838}]`; a write like `update app_settings set value=1` (passed as `q`) returns a read-only/permission error, not success.

- [ ] **Step 4: Commit** `git add db/migrations/005_readonly_role.sql db/migrations/008_run_readonly_select.sql && git commit -m "feat: read-only role + guarded run_readonly_select RPC"`

---

## Task 2: SQL guard (TDD)

**Files:** Create `src/lib/sql-guard.ts`, Test `src/lib/sql-guard.test.ts`

- [ ] **Step 1: Failing test `src/lib/sql-guard.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { validateReadonlySql } from "./sql-guard";

const ok = (q: string) => validateReadonlySql(q);

describe("validateReadonlySql", () => {
  it("accepts a SELECT", () => {
    expect(ok("select * from clientes_view")).toEqual({ ok: true, sql: "select * from clientes_view" });
  });
  it("accepts a WITH (CTE)", () => {
    expect(ok("with x as (select 1 a) select * from x").ok).toBe(true);
  });
  it("strips a single trailing semicolon", () => {
    expect(ok("select 1;")).toEqual({ ok: true, sql: "select 1" });
  });
  it("does NOT flag columns like created_at / updated_at", () => {
    expect(ok("select created_at, updated_at from vendas_view").ok).toBe(true);
  });
  it("rejects empty", () => { expect(ok("   ").ok).toBe(false); });
  it("rejects non-SELECT", () => { expect(ok("delete from clientes_view").ok).toBe(false); });
  it("rejects writes", () => {
    for (const w of ["update clientes_view set x=1", "drop table t", "insert into t values (1)", "truncate t", "alter table t add c int", "grant all to x"]) {
      expect(ok(w).ok).toBe(false);
    }
  });
  it("rejects multiple statements", () => {
    expect(ok("select 1; select 2").ok).toBe(false);
  });
  it("rejects SELECT INTO (write)", () => {
    expect(ok("select * into newt from clientes_view").ok).toBe(false);
  });
});
```

- [ ] **Step 2: run → fail** `npm test`.

- [ ] **Step 3: Implement `src/lib/sql-guard.ts`**
```ts
export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|into|call|merge|vacuum|reindex|comment|lock|listen|notify|set|reset)\b/i;

export function validateReadonlySql(raw: string): GuardResult {
  let q = (raw ?? "").trim();
  if (!q) return { ok: false, reason: "empty query" };
  if (q.endsWith(";")) q = q.slice(0, -1).trim();
  if (q.includes(";")) return { ok: false, reason: "only a single statement is allowed" };
  if (!/^(select|with)\b/i.test(q)) return { ok: false, reason: "only SELECT queries are allowed" };
  const m = q.match(FORBIDDEN);
  if (m) return { ok: false, reason: `disallowed keyword: ${m[1].toLowerCase()}` };
  return { ok: true, sql: q };
}
```
> `\b` word boundaries mean `created_at`/`updated_at` are NOT flagged (the boundary after `create`/`update` fails against the following letter). The read-only role is the real enforcement; this guard blocks multi-statement + obvious writes early and gives Claude a clean error to retry against.

- [ ] **Step 4: run → pass** `npm test`. **Commit** `feat: read-only SQL guard (TDD)`.

---

## Task 3: Schema description + chat agent

**Files:** Create `src/features/chat/schema.ts`, `src/features/chat/agent.ts`

- [ ] **Step 1: `src/features/chat/schema.ts`**
```ts
export const SCHEMA_DESCRIPTION = `Postgres database (query these read-only views only):

clientes_view — one row per patient (337 rows)
  id text, nome text, telefone text, email text, origem text,
  numero_vendas int, receita_total numeric, descontos numeric, ticket_medio numeric,
  cadastro_at timestamptz (signup date), procedimentos_raw text

vendas_view — one row per completed sale (838 rows, all status=1)
  id text, sold_at timestamptz, sold_month date, cliente_supabase_id text (-> clientes_view.id),
  cliente_nome text, procedimentos text, subtotal numeric, total numeric (BILLED revenue),
  valor_pago numeric (COLLECTED), desconto numeric, profissional text

vendas_monthly — monthly rollup
  month date, sales int, revenue_billed numeric, revenue_collected numeric

procedimentos_expanded — one row per (patient, procedure, qty)
  id text (-> clientes_view.id), procedure_name text, qty int

Notes: money is BRL. "Revenue" = vendas_view.total (billed) unless asked for collected (valor_pago).
A patient "bought" if they have rows in vendas_view. Procedure names include dosages (e.g. "MONJAURO 2,5 MG").`;
```

- [ ] **Step 2: `src/features/chat/agent.ts`**
```ts
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
```

- [ ] **Step 3: Verify** `npx tsc --noEmit`. **Commit** `feat: text-to-SQL chat agent (Claude tool-use + run_sql)`.

---

## Task 4: Streaming chat API route

**Files:** Create `src/app/api/chat/route.ts`

- [ ] **Step 1: Implement**
```ts
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
```

- [ ] **Step 2: Verify** `npx tsc --noEmit && npm run build` (disable sandbox). `/api/chat` should appear as a route. **Commit** `feat: streaming /api/chat route (auth-gated)`.

---

## Task 5: Chat UI (Ask bar → slide-over panel)

**Files:** Create `src/features/chat/chat-launcher.tsx`; Modify `src/app/(app)/page.tsx`

- [ ] **Step 1: `src/features/chat/chat-launcher.tsx`** (`"use client"`)
```tsx
"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, open]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }, { role: "assistant", content: "" }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value);
        setMsgs((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
    } catch {
      setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: "assistant", content: "Sorry — something went wrong." }; return c; });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div onClick={() => setOpen(true)} role="button"
        style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 16, padding: "15px 20px", color: "var(--muted)", fontSize: 14.5, cursor: "text" }}>
        <span>🔍</span>
        <span>Ask anything about your clinic — &ldquo;revenue this month&rdquo;, &ldquo;patients who did Botox&rdquo;…</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold-soft)", background: "rgba(217,178,76,.1)", border: "1px solid rgba(217,178,76,.3)", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>AI ✦</span>
      </div>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "94vw", background: "#0e0e10", borderLeft: "1px solid var(--line)", zIndex: 51, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>Ask <span className="gold-text">Integrallys</span></div>
              <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {msgs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Try: &ldquo;quanto faturamos em maio?&rdquo; · &ldquo;top 5 pacientes por receita&rdquo; · &ldquo;quantos fizeram Botox?&rdquo;</p>}
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%",
                  background: m.role === "user" ? "var(--gold)" : "var(--panel-hi)", color: m.role === "user" ? "#0a0a0b" : "var(--txt)",
                  border: m.role === "user" ? "none" : "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ padding: 14, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask about patients, sales, revenue…" disabled={busy}
                style={{ flex: 1, padding: "11px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13.5 }} />
              <button onClick={send} disabled={busy} style={{ background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "0 16px", fontWeight: 700, cursor: "pointer" }}>{busy ? "…" : "Send"}</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: In `src/app/(app)/page.tsx`** replace the `AskBar` import + usage with `ChatLauncher`:
  - Remove `import { AskBar } from "@/features/overview/ask-bar";` → add `import { ChatLauncher } from "@/features/chat/chat-launcher";`
  - Replace `<AskBar />` with `<ChatLauncher />`.
  (Leave `ask-bar.tsx` in place; it's now unused but harmless.)

- [ ] **Step 3: Verify** `npm test && npm run build` (disable sandbox) → green; `chat-launcher.tsx` is `"use client"`.

- [ ] **Step 4: Live verify (controller, Playwright):** log in, click the Ask bar, type "quantos pacientes fizeram Botox?" and "qual o faturamento total?"; confirm a streamed answer with correct numbers (Botox count from `procedimentos_expanded`; revenue ≈ R$424k). Screenshot the open chat with an answer. Check no console errors.

- [ ] **Step 5: Commit** `feat: chat launcher + panel wired to /api/chat`.

---

## Self-Review
- [ ] **Spec coverage:** read-only role + executor (T1), TS guard (T2), agent w/ caching + adaptive thinking + streaming (T3), auth-gated streaming route (T4), Ask-bar→panel UI + live verify (T5). Text-to-SQL, no vector store ✓.
- [ ] **Security:** two layers — `validateReadonlySql` rejects non-SELECT/multi-statement; `run_readonly_select` runs as `crm_readonly` (SELECT-only on views), read-only txn, 5s timeout, 1000-row cap. Route is auth-gated; keys stay server-side.
- [ ] **Type consistency:** `validateReadonlySql` → `GuardResult`; `runChat(history, onText)` used by the route; `run_readonly_select(q)` RPC name matches across agent + migration.

## Next: Plan 5 — Settings (editable goals), Gestek sync button, Vercel deploy.
