# Chat: mark bookings cancelado / falta — design

**Date:** 2026-06-08
**Status:** Approved (design)

## Problem

The user wants to type a natural-language sentence into the AI chat — e.g.
*"pedro e a patricia cancelaram hoje"* — and have the agent find the matching
appointment(s) in the day's schedule and record their outcome (cancelled or
no-show). Today the chat agent is **read-only**: its single `run_sql` tool is
locked to SELECT/WITH via `validateReadonlySql`, so it can report bookings but
cannot change them.

## What already exists (no new infrastructure needed)

- `agenda_attendance` ([db/migrations/013_agenda_attendance.sql](../../../db/migrations/013_agenda_attendance.sql))
  layers outcomes on top of the sync-owned `gestek_agenda`. The sync never
  touches it. Columns: `agenda_id` (PK, FK → gestek_agenda), `status` ∈
  {`realizado`,`cancelado`,`falta`}, `source` ∈ {`chat`,`xlsx`}, `note`,
  `updated_at`. **`source = 'chat'` was already reserved "for a future path"** —
  this feature is that path.
- `agenda_view` already computes the EFFECTIVE status, giving any override
  priority over the assumed default (past→realizado, future→agendado).
- The xlsx import ([src/features/attendance/import.ts](../../../src/features/attendance/import.ts))
  is a proven write pattern: a typed `upsert` on `agenda_attendance` with
  `onConflict: "agenda_id"`. No raw write-SQL anywhere.
- `agenda_attendance` already grants insert/update/delete to `service_role`
  (migration 013), and the chat agent uses the service client. **No migration
  is required.**

Because writes are confined to `agenda_attendance` and can never insert patients
or edit `gestek_agenda`, this feature is **outside the class** of the
mass-duplication incident.

## Decisions (from brainstorming)

1. **Write mechanism:** a dedicated, typed tool — not constrained write-SQL.
2. **Confirmation:** always confirm first. The agent lists the exact match(es)
   and waits for the user's "sim" before writing.
3. **Statuses:** `cancelado` and `falta` only. No chat-driven `realizado` or
   undo. (`realizado` stays automatic for past bookings without an override.)
4. **Default date:** when the user does not specify a date, "today" is assumed.
   Other dates are allowed when stated ("ontem a fulana faltou").

## Architecture & data flow

The agent gains a **second tool**, `set_attendance`, alongside `run_sql`.

For "pedro e a patricia cancelaram hoje":

1. **Find** — agent calls `run_sql` (read-only, unchanged) against `agenda_view`,
   filtering by the resolved date and the names. Selects
   `id, cliente_nome, appointment_at, profissional_nome, procedimentos, status`.
2. **Confirm** — agent shows the exact matches (name, time, professional,
   procedure) and asks for confirmation. It writes nothing yet.
3. **Write** — after "sim", the agent calls `set_attendance` **once per booking
   id**. Each call upserts one row into `agenda_attendance`
   (`status`, `source='chat'`, `note` = the user's phrase, `updated_at = now()`).
4. **Reflect** — `agenda_view` surfaces the override, so dashboard
   attendance / comparecimento numbers update on next load.

```
You ──"pedro e patricia cancelaram hoje"──▶ agent
                                              │ run_sql (read) → matches
        ◀──"Encontrei 2: … marcar CANCELADO?"┘
You ──"sim"────────────────────────────────▶ agent
                                              │ set_attendance(id1,'cancelado')
                                              │ set_attendance(id2,'cancelado')
        ◀──"✓ 2 cancelados"──────────────────┘
```

**Safety property:** `set_attendance` can only touch `agenda_attendance`, and
only with `status ∈ {cancelado, falta}`. It cannot run arbitrary SQL, insert
patients, or edit `gestek_agenda`.

## The `set_attendance` tool

Typed interface (mirrors the xlsx upsert, no raw SQL):

```ts
set_attendance(agenda_id: string, status: "cancelado" | "falta", note?: string)
```

- Validates `status` is one of the two allowed values; rejects anything else.
- Upserts into `agenda_attendance` on conflict `agenda_id` (re-marking updates
  the existing row).
- `source` is hard-coded to `'chat'`; `note` stores the user's phrase for audit.
- Returns `{ ok, agenda_id, cliente_nome, status }` (or `{ error }`) so the agent
  confirms back accurately and never reports a silent partial failure.

### Agent loop change

In [src/features/chat/agent.ts](../../../src/features/chat/agent.ts), the tool
list gains `set_attendance`, and the tool-dispatch block (currently only handling
`run_sql`) gains a `set_attendance` branch. Same streaming loop, one more `case`.

### System prompt additions

Instruct the agent that to change an outcome it must:
(a) find the booking(s) with `run_sql`; (b) **list them and obtain explicit
confirmation**; (c) only then call `set_attendance`, once per id. Default the date
to today when unstated; honor other dates when the user gives them.

## Ambiguity & error handling

- **0 matches** → agent reports "não encontrei agendamento para X em <data>" and
  writes nothing.
- **Multiple bookings for one name** → agent lists all and asks which (or "todas?").
- **Bad id / FK miss / DB error** → tool returns `{ error }`; agent surfaces it.
  No partial silent failure.

## Auth

The write rides the existing chat API route, which already requires a logged-in
Supabase user. No new public surface.

## Testing (TDD)

Unit tests for `set_attendance`:
1. valid `cancelado` upsert writes the expected row (`source='chat'`, note set);
2. valid `falta` upsert;
3. an invalid status is rejected (no write);
4. upsert-on-conflict updates an existing row rather than erroring.

Agent-level test:
5. the agent does not call `set_attendance` before the user confirms.

## Out of scope

- Chat-driven `realizado` or undo/revert of an override.
- Any change to the sync, `gestek_agenda`, or patient records.
- A non-chat UI for marking attendance (the xlsx import already covers bulk).
