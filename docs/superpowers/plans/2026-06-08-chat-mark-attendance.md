# Chat: mark bookings cancelado / falta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI chat record a booking's outcome as `cancelado` or `falta` from a natural-language sentence ("pedro e a patricia cancelaram hoje"), after finding the bookings and getting explicit user confirmation.

**Architecture:** The chat agent gains a second, typed tool `set_attendance` alongside the read-only `run_sql`. The agent first finds bookings with `run_sql` against `agenda_view`, lists them, waits for confirmation, then calls `set_attendance` once per booking. `set_attendance` upserts one row into the existing `agenda_attendance` table (`source='chat'`). Pure decision logic is isolated from the Supabase write via dependency injection, matching the codebase's existing sync pattern.

**Tech Stack:** TypeScript, Next.js 16, `@anthropic-ai/sdk`, Supabase (service client), Vitest.

**Spec:** [docs/superpowers/specs/2026-06-08-chat-mark-attendance-design.md](../specs/2026-06-08-chat-mark-attendance-design.md)

---

## Background the executor needs

- `agenda_attendance` ([db/migrations/013_agenda_attendance.sql](../../../db/migrations/013_agenda_attendance.sql)) already exists with columns `agenda_id` (PK, FK → `gestek_agenda.id`), `status` ∈ {`realizado`,`cancelado`,`falta`}, `source` ∈ {`chat`,`xlsx`}, `note`, `updated_at`. It already grants insert/update to `service_role`. **No migration is needed.**
- `agenda_view` already gives any `agenda_attendance` override priority over the assumed status, so writes are reflected automatically.
- The chat API route ([src/app/api/chat/route.ts:10-11](../../../src/app/api/chat/route.ts#L10-L11)) already returns 401 for unauthenticated requests. No auth work needed.
- The codebase prefers **dependency injection over mocking** for tests (see [src/features/sync/run-sync.test.ts](../../../src/features/sync/run-sync.test.ts), which injects a fake store). We follow that: `set_attendance`'s pure logic takes a `write` function; tests inject a fake writer.
- Importing `server-only` in a Vitest (node) run is safe — `run-sync.test.ts` already does it transitively.
- This feature writes **only** to `agenda_attendance`; it never inserts patients or touches `gestek_agenda`. It is outside the class of the past mass-duplication incident.

## File structure

- **Create** `src/features/chat/prompt.ts` — the system prompt (moved out of `agent.ts`), extended with the attendance-write instructions. One responsibility: the agent's instructions.
- **Create** `src/features/chat/prompt.test.ts` — regression test that the confirmation directives are present.
- **Create** `src/features/chat/attendance.ts` — pure `setAttendance(input, write)` + the `AttendanceStatus`/`AttendanceRow`/`AttendanceWriter` types. No Supabase imports.
- **Create** `src/features/chat/attendance.test.ts` — unit tests for `setAttendance` with an injected fake writer.
- **Modify** `src/features/chat/agent.ts` — import `SYSTEM` from `prompt.ts`; add the `dbWriteAttendance` adapter; register the `set_attendance` tool; dispatch it in the tool loop.
- **Modify** `src/features/chat/schema.ts` — note that `status_source` can now be `'chat'`.

---

## Task 1: Extract & extend the system prompt

**Files:**
- Create: `src/features/chat/prompt.ts`
- Modify: `src/features/chat/agent.ts:9-16` (remove the `SYSTEM` const, import it instead)

- [ ] **Step 1: Create `prompt.ts` with the moved + extended prompt**

Create `src/features/chat/prompt.ts`:

```ts
import { SCHEMA_DESCRIPTION } from "./schema";

export const SYSTEM = `Você é o assistente de dados do CRM da clínica de estética Integrallys. Responda perguntas sobre pacientes e vendas consultando o banco de dados com a ferramenta run_sql — nunca chute números.

${SCHEMA_DESCRIPTION}

Como trabalhar:
- Chame run_sql com UM SELECT somente leitura do Postgres para obter os fatos necessários. Agregue no SQL; mantenha os resultados pequenos.
- Se uma consulta falhar, leia o erro e tente uma consulta corrigida (no máximo algumas tentativas).
- Depois responda de forma concisa em português (pt-BR). Formate dinheiro como "R$ 1.234,56".

Registrar cancelamento ou falta de um agendamento (ferramenta set_attendance):
- Você pode marcar um agendamento como 'cancelado' (o paciente cancelou) ou 'falta' (não compareceu). NUNCA marque 'realizado' pelo chat.
- Passo 1 — ENCONTRE: use run_sql em agenda_view selecionando id, cliente_nome, appointment_at, profissional_nome, procedimentos, status. Se o usuário não disser a data, assuma HOJE (no fuso da clínica).
- Passo 2 — CONFIRME: liste o que encontrou (nome, horário, profissional) e PEÇA CONFIRMAÇÃO explícita. NÃO chame set_attendance antes de o usuário confirmar.
- Passo 3 — GRAVE: só após o "sim", chame set_attendance UMA VEZ por agendamento (um agenda_id por chamada), com o status correto. Passe a frase original do usuário em note.
- Se um nome não corresponder a nenhum agendamento, diga que não encontrou e não grave nada. Se corresponder a vários, liste-os e pergunte qual.`;
```

- [ ] **Step 2: Point `agent.ts` at the new module**

In `src/features/chat/agent.ts`, delete the local `const SYSTEM = ` block (currently lines 9-16) and add an import near the top, next to the existing schema import:

```ts
import { SYSTEM } from "./prompt";
```

Remove the now-unused `import { SCHEMA_DESCRIPTION } from "./schema";` line from `agent.ts` (it moved to `prompt.ts`).

- [ ] **Step 3: Verify the app still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `npm test`
Expected: PASS (no behavior changed yet).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/prompt.ts src/features/chat/agent.ts
git commit -m "refactor(chat): extract system prompt + add attendance instructions"
```

---

## Task 2: Pure `setAttendance` decision logic (TDD)

**Files:**
- Create: `src/features/chat/attendance.ts`
- Test: `src/features/chat/attendance.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/chat/attendance.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { setAttendance, type AttendanceRow } from "./attendance";

function fakeWriter(cliente_nome: string | null = "Pedro Silva") {
  const calls: AttendanceRow[] = [];
  const write = vi.fn(async (row: AttendanceRow) => {
    calls.push(row);
    return { cliente_nome };
  });
  return { write, calls };
}

describe("setAttendance", () => {
  it("writes a cancelado row and returns ok JSON with the patient name", async () => {
    const { write, calls } = fakeWriter("Pedro Silva");
    const out = await setAttendance({ agenda_id: "a1", status: "cancelado", note: "pedro cancelou hoje" }, write);
    expect(calls).toEqual([{ agenda_id: "a1", status: "cancelado", note: "pedro cancelou hoje" }]);
    expect(JSON.parse(out)).toEqual({ ok: true, agenda_id: "a1", cliente_nome: "Pedro Silva", status: "cancelado" });
  });

  it("writes a falta row", async () => {
    const { write } = fakeWriter("Bia");
    const out = await setAttendance({ agenda_id: "a2", status: "falta" }, write);
    expect(JSON.parse(out)).toMatchObject({ ok: true, status: "falta" });
  });

  it("rejects an invalid status without writing", async () => {
    const { write } = fakeWriter();
    const out = await setAttendance({ agenda_id: "a1", status: "realizado" }, write);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(out).error).toMatch(/status inválido/i);
  });

  it("rejects a missing agenda_id without writing", async () => {
    const { write } = fakeWriter();
    const out = await setAttendance({ status: "cancelado" }, write);
    expect(write).not.toHaveBeenCalled();
    expect(JSON.parse(out).error).toMatch(/agenda_id/i);
  });

  it("normalizes a blank note to null", async () => {
    const { write, calls } = fakeWriter();
    await setAttendance({ agenda_id: "a1", status: "cancelado", note: "   " }, write);
    expect(calls[0].note).toBeNull();
  });

  it("returns an error JSON (never throws) when the writer fails", async () => {
    const write = vi.fn(async () => { throw new Error("FK violation"); });
    const out = await setAttendance({ agenda_id: "bad", status: "falta" }, write);
    expect(JSON.parse(out).error).toMatch(/FK violation/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- attendance`
Expected: FAIL with "Cannot find module './attendance'" / `setAttendance is not defined`.

- [ ] **Step 3: Implement `attendance.ts`**

Create `src/features/chat/attendance.ts`:

```ts
export type AttendanceStatus = "cancelado" | "falta";

export type AttendanceRow = {
  agenda_id: string;
  status: AttendanceStatus;
  note: string | null;
};

/** Writes one attendance override and returns the booking's patient name for confirmation. */
export type AttendanceWriter = (row: AttendanceRow) => Promise<{ cliente_nome: string | null }>;

type RawInput = { agenda_id?: unknown; status?: unknown; note?: unknown };

/**
 * Validate the model's tool input and (if valid) write a single attendance override.
 * Returns a JSON string for the tool_result — `{ ok, agenda_id, cliente_nome, status }`
 * on success, or `{ error }`. Never throws.
 */
export async function setAttendance(input: RawInput, write: AttendanceWriter): Promise<string> {
  const agenda_id = typeof input.agenda_id === "string" ? input.agenda_id.trim() : "";
  if (!agenda_id) return JSON.stringify({ error: "agenda_id obrigatório." });

  const status = input.status;
  if (status !== "cancelado" && status !== "falta") {
    return JSON.stringify({ error: `status inválido: ${String(status)} (use 'cancelado' ou 'falta').` });
  }

  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim() : null;

  try {
    const { cliente_nome } = await write({ agenda_id, status, note });
    return JSON.stringify({ ok: true, agenda_id, cliente_nome, status });
  } catch (e) {
    return JSON.stringify({ error: e instanceof Error ? e.message : "falha ao gravar." });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- attendance`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/chat/attendance.ts src/features/chat/attendance.test.ts
git commit -m "feat(chat): pure setAttendance decision logic with injected writer"
```

---

## Task 3: Wire the `set_attendance` tool into the agent

**Files:**
- Modify: `src/features/chat/agent.ts` (add adapter, tool def, dispatch case)
- Modify: `src/features/chat/schema.ts:30` (document `'chat'` as a status_source)

- [ ] **Step 1: Add the DB writer adapter in `agent.ts`**

In `src/features/chat/agent.ts`, add this import alongside the others:

```ts
import { setAttendance, type AttendanceRow } from "./attendance";
```

Then add the adapter function right after the existing `runSql` function:

```ts
// Real writer for set_attendance: upsert one override into agenda_attendance (source='chat'),
// then read back the patient name so the agent's confirmation is grounded in the DB.
async function dbWriteAttendance(row: AttendanceRow): Promise<{ cliente_nome: string | null }> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("agenda_attendance").upsert(
    { agenda_id: row.agenda_id, status: row.status, source: "chat", note: row.note, updated_at: new Date().toISOString() },
    { onConflict: "agenda_id" },
  );
  if (error) throw new Error(error.message);
  const { data } = await sb.from("gestek_agenda").select("cliente_nome").eq("id", row.agenda_id).maybeSingle();
  return { cliente_nome: (data as { cliente_nome?: string | null } | null)?.cliente_nome ?? null };
}
```

- [ ] **Step 2: Register the `set_attendance` tool**

In `src/features/chat/agent.ts`, add a second entry to the `TOOLS` array (after the `run_sql` object):

```ts
  {
    name: "set_attendance",
    description:
      "Registra o comparecimento de UM agendamento como 'cancelado' (o paciente cancelou) ou 'falta' (não compareceu). Use SOMENTE depois de (1) localizar o agendamento com run_sql e (2) o usuário CONFIRMAR explicitamente. Chame uma vez por agendamento (um agenda_id por chamada). Nunca use para marcar 'realizado'.",
    input_schema: {
      type: "object",
      properties: {
        agenda_id: { type: "string", description: "id do agendamento (agenda_view.id)." },
        status: { type: "string", enum: ["cancelado", "falta"], description: "'cancelado' = cancelou; 'falta' = não compareceu." },
        note: { type: "string", description: "Frase original do usuário, para auditoria. Opcional." },
      },
      required: ["agenda_id", "status"],
    },
  },
```

- [ ] **Step 3: Dispatch the new tool in the agent loop**

In `src/features/chat/agent.ts`, replace the existing tool-dispatch loop (currently the `for (const block of msg.content) { if (block.type === "tool_use" && block.name === "run_sql") {...} }` block) with one that handles both tools:

```ts
    for (const block of msg.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "run_sql") {
        const query = (block.input as { query?: string }).query ?? "";
        results.push({ type: "tool_result", tool_use_id: block.id, content: await runSql(query) });
      } else if (block.name === "set_attendance") {
        const content = await setAttendance(block.input as { agenda_id?: unknown; status?: unknown; note?: unknown }, dbWriteAttendance);
        results.push({ type: "tool_result", tool_use_id: block.id, content });
      }
    }
```

- [ ] **Step 4: Document `'chat'` as a status_source in the schema description**

In `src/features/chat/schema.ts`, change the `status_source` line (line 30) from:

```
  status_source text — origem do status: 'xlsx' | null (null = assumido automaticamente)
```

to:

```
  status_source text — origem do status: 'xlsx' | 'chat' | null (null = assumido automaticamente)
```

- [ ] **Step 5: Type-check, lint, and run the full suite**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: no type errors, no lint errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/chat/agent.ts src/features/chat/schema.ts
git commit -m "feat(chat): set_attendance tool — mark bookings cancelado/falta from chat"
```

---

## Task 4: Prompt regression test

**Files:**
- Create: `src/features/chat/prompt.test.ts`

This locks the safety-critical confirmation instruction so a future edit can't silently remove it.

- [ ] **Step 1: Write the test**

Create `src/features/chat/prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SYSTEM } from "./prompt";

describe("chat system prompt", () => {
  it("tells the agent to confirm before writing attendance", () => {
    expect(SYSTEM).toMatch(/CONFIRMAÇÃO/i);
    expect(SYSTEM).toMatch(/set_attendance/);
  });

  it("forbids marking 'realizado' via chat", () => {
    expect(SYSTEM.toLowerCase()).toContain("nunca marque 'realizado'");
  });

  it("defaults the date to today when unstated", () => {
    expect(SYSTEM).toMatch(/assuma HOJE/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm test -- prompt`
Expected: PASS (3 tests). (It should pass immediately — the directives were added in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/features/chat/prompt.test.ts
git commit -m "test(chat): lock attendance confirmation directives in system prompt"
```

---

## Task 5: Manual end-to-end verification (live chat)

Automated tests can't verify the model actually pauses for confirmation or that the DB upsert+on-conflict behaves — those need a live run. Do this against the running dev app, signed in.

**Preconditions:** `ANTHROPIC_API_KEY` set in `.env.local`; there is at least one booking in `gestek_agenda` for today (or pick a real name/date from `agenda_view`). `SYNC_ENABLED` is irrelevant here — this path doesn't sync.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Open the app and sign in, then open the chat panel.

- [ ] **Step 2: Confirmation-first check**

Type a real case, e.g. `fulano cancelou hoje` (use a name that exists today).
Expected: the agent **lists** the matching booking(s) and **asks for confirmation** — it must NOT report a write yet.

- [ ] **Step 3: Approve and verify the write**

Reply `sim`.
Expected: agent reports `✓ … cancelado`. Confirm in the DB (with your approval to read prod, or against local) that `agenda_attendance` has a row for that `agenda_id` with `status='cancelado'`, `source='chat'`, and `note` holding your phrase.

- [ ] **Step 4: Re-mark / on-conflict check**

In the chat, mark the **same** booking as `falta` (e.g. `na verdade fulano faltou` → confirm).
Expected: the existing row is **updated** to `status='falta'` (not a duplicate row; `agenda_id` is the PK).

- [ ] **Step 5: No-match check**

Type `zzqx cancelou hoje` (a name that doesn't exist).
Expected: the agent says it found no booking and writes nothing.

- [ ] **Step 6: Dashboard reflection (optional)**

Reload the Overview. The attendance / comparecimento figures should reflect the new cancelado/falta, because `agenda_view` surfaces the override.

---

## Self-review notes

- **Spec coverage:** find→confirm→write flow (Tasks 1,3,5), typed `set_attendance` tool (Task 3), pure validation incl. invalid-status rejection (Task 2), source='chat' + note audit (Tasks 2,3), confirm-first directive (Tasks 1,4), ambiguity/no-match handling (prompt in Task 1, verified Task 5), auth (pre-existing, noted), no migration (noted), tests incl. on-conflict update (Task 5 manual, since it's DB behavior). All spec sections map to a task.
- **No raw write-SQL:** `run_sql` is untouched and stays read-only; the only write is the typed `agenda_attendance` upsert.
