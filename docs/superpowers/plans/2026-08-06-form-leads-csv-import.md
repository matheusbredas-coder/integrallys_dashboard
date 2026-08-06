# Form Leads CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user upload a CSV of leads (Meta Ads Manager export shape), preview how many are new/duplicate/invalid, and — only on explicit confirm — add the new ones to `form_leads` and report them to Meta exactly like the live webhook ingest does.

**Architecture:** A pure CSV parser + classifier (`csv.ts`) feeds two new server actions (`previewFormLeadsCsv`, `commitFormLeadsCsv` in `actions.ts`) that reuse the existing `mapSheetFields` mapping and the `form_leads_external_id_key` unique index for dedup. The UI (`form-leads-table.tsx`) reads the file client-side, calls preview, shows counts with Confirmar/Cancelar, and only calls commit when the user confirms.

**Tech Stack:** Next.js server actions, Supabase (service-role client), Vitest + Testing Library (jsdom). No new npm dependency — the CSV parser is hand-rolled.

## Global Constraints

- No new dependency for CSV parsing — hand-rolled, quote-aware parser only.
- A CSV row whose `external_id` already exists in `form_leads` is skipped entirely — never updated, never refreshed. Only genuinely new rows are inserted.
- Preview (`previewFormLeadsCsv`) writes nothing and never calls `enqueueStageEvent`. Only `commitFormLeadsCsv`, called from an explicit Confirmar click, writes to the database and fires Meta events.
- Every row this feature inserts starts at stage `"novo"` — the only stage import ever sets.
- Reuse `mapSheetFields` (`./mapping`) for field mapping and the existing unique index on `form_leads.external_id` for dedup — no schema changes.
- Both new server actions are guarded by the same `requireUser()` session check `updateFormLeadStage` already uses in `actions.ts`.

---

### Task 1: CSV row parser

**Files:**
- Create: `src/features/form-leads/csv.ts`
- Test: `src/features/form-leads/csv.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): Record<string, string>[]` — one object per data row, keyed by the raw (un-normalized) header text. Blank lines (including a trailing one) are dropped. A header-only file returns `[]`.

- [ ] **Step 1: Write the failing test**

Create `src/features/form-leads/csv.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  it("maps each data row to a header -> cell object", () => {
    const text = "id,nome\nl:1,Ana\nl:2,Bea\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("keeps a comma inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Silva, Ana"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: "Silva, Ana" }]);
  });

  it("keeps a newline inside a quoted field", () => {
    const text = 'id,nota\nl:1,"linha um\nlinha dois"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nota: "linha um\nlinha dois" }]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const text = 'id,nome\nl:1,"Maria ""Mah"" Silva"\n';
    expect(parseCsv(text)).toEqual([{ id: "l:1", nome: 'Maria "Mah" Silva' }]);
  });

  it("handles CRLF line endings", () => {
    const text = "id,nome\r\nl:1,Ana\r\nl:2,Bea\r\n";
    expect(parseCsv(text)).toEqual([
      { id: "l:1", nome: "Ana" },
      { id: "l:2", nome: "Bea" },
    ]);
  });

  it("ignores a blank trailing line and works with no closing newline", () => {
    expect(parseCsv("id,nome\nl:1,Ana\n\n")).toEqual([{ id: "l:1", nome: "Ana" }]);
    expect(parseCsv("id,nome\nl:1,Ana")).toEqual([{ id: "l:1", nome: "Ana" }]);
  });

  it("returns an empty array for a header-only file", () => {
    expect(parseCsv("id,nome\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/form-leads/csv.test.ts`
Expected: FAIL — `Cannot find module './csv'` (the file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/features/form-leads/csv.ts`:

```ts
// A small, quote-aware CSV parser for the leads-import feature. Hand-rolled rather than a
// dependency, matching how this codebase already hand-rolls its other parsers (see
// email-parse.ts). Only what a Meta Ads Manager lead export needs: quoted fields (with
// embedded commas/newlines and "" as an escaped quote), CRLF or LF line endings, and a
// tolerant read of blank lines.

/** Splits raw CSV text into rows of raw cell strings, quote-aware. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1; // swallow; the following \n (or end of text) closes the row
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  // Text that doesn't end on a newline still has one pending field/row.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Parses CSV text into header -> cell objects, one per data row.
 *
 * The first row is the header; a row is skipped when every one of its cells is blank
 * (this is what makes a trailing blank line a no-op instead of an empty-string data row).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return [];

  const [header, ...dataRows] = rows;
  return dataRows
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      header.forEach((label, index) => {
        obj[label] = row[index] ?? "";
      });
      return obj;
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/form-leads/csv.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/form-leads/csv.ts src/features/form-leads/csv.test.ts
git commit -m "feat(marketing): hand-rolled CSV row parser for leads import"
```

---

### Task 2: Map CSV rows to leads and classify new/duplicate/invalid

**Files:**
- Modify: `src/features/form-leads/csv.ts`
- Test: `src/features/form-leads/csv.test.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 1); `mapSheetFields(fields: Record<string, unknown>): MappedLead` and `type MappedLead` from `./mapping` (existing).
- Produces:
  - `type CsvLeadRow = { rowNumber: number; lead: MappedLead }`
  - `type CsvLeadStatus = "new" | "duplicate" | "invalid"`
  - `type ClassifiedCsvLeadRow = CsvLeadRow & { status: CsvLeadStatus }`
  - `parseCsvLeads(text: string): CsvLeadRow[]`
  - `isInvalidLead(lead: MappedLead): boolean`
  - `classifyCsvLeads(rows: CsvLeadRow[], existingExternalIds: ReadonlySet<string>): ClassifiedCsvLeadRow[]`

- [ ] **Step 1: Write the failing test**

Append to `src/features/form-leads/csv.test.ts`:

```ts
import { parseCsvLeads, isInvalidLead, classifyCsvLeads } from "./csv";

describe("parseCsvLeads", () => {
  it("maps each row through mapSheetFields and numbers rows starting at 2 (header is row 1)", () => {
    const text = "id,nome_completo,email,telefone\nl:1,Ana,ana@x.com,+5511999999999\n";
    expect(parseCsvLeads(text)).toEqual([
      {
        rowNumber: 2,
        lead: {
          external_id: "l:1",
          name: "Ana",
          phone: "5511999999999",
          email: "ana@x.com",
          campaign: null,
          form_name: null,
          submitted_at: null,
          raw: { id: "l:1", nome_completo: "Ana", email: "ana@x.com", telefone: "+5511999999999" },
        },
      },
    ]);
  });
});

describe("isInvalidLead", () => {
  const base = { external_id: null, campaign: null, form_name: null, submitted_at: null, raw: {} };

  it("is true only when name, phone and email are all null", () => {
    expect(isInvalidLead({ ...base, name: null, phone: null, email: null })).toBe(true);
    expect(isInvalidLead({ ...base, name: "Ana", phone: null, email: null })).toBe(false);
  });
});

describe("classifyCsvLeads", () => {
  it("marks the first occurrence of an id new and later ones in the same file duplicate", () => {
    const rows = parseCsvLeads("id,nome_completo\nl:1,Ana\nl:1,Ana Repetida\n");
    expect(classifyCsvLeads(rows, new Set()).map((r) => r.status)).toEqual(["new", "duplicate"]);
  });

  it("marks an id already in the database as duplicate", () => {
    const rows = parseCsvLeads("id,nome_completo\nl:1,Ana\n");
    expect(classifyCsvLeads(rows, new Set(["l:1"])).map((r) => r.status)).toEqual(["duplicate"]);
  });

  it("marks a row with no identity fields invalid, even with other columns present", () => {
    const rows = parseCsvLeads("id,nome_completo,campanha\nl:1,,Campanha X\n");
    expect(classifyCsvLeads(rows, new Set()).map((r) => r.status)).toEqual(["invalid"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/form-leads/csv.test.ts`
Expected: FAIL — `parseCsvLeads`, `isInvalidLead`, `classifyCsvLeads` are not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/features/form-leads/csv.ts`:

```ts
import { mapSheetFields, type MappedLead } from "./mapping";

export type CsvLeadRow = { rowNumber: number; lead: MappedLead };

/** Parses CSV text into mapped leads. `rowNumber` counts the header as row 1. */
export function parseCsvLeads(text: string): CsvLeadRow[] {
  return parseCsv(text).map((fields, index) => ({
    rowNumber: index + 2,
    lead: mapSheetFields(fields),
  }));
}

/** True when a row carries nothing to identify the person by. */
export function isInvalidLead(lead: MappedLead): boolean {
  return lead.name === null && lead.phone === null && lead.email === null;
}

export type CsvLeadStatus = "new" | "duplicate" | "invalid";
export type ClassifiedCsvLeadRow = CsvLeadRow & { status: CsvLeadStatus };

/**
 * Classifies each row as new / duplicate / invalid.
 *
 * A row is a duplicate if its `external_id` is already in `existingExternalIds` (already in
 * the CRM) OR was already seen earlier in this same file — first occurrence within a file
 * wins, later ones are duplicates, mirroring the "first entry wins" rule mapSheetFields
 * already applies to colliding headers. A row with no `external_id` is never deduped (same
 * as the DB's unique index, which treats NULL as distinct) — it's always "new".
 */
export function classifyCsvLeads(
  rows: CsvLeadRow[],
  existingExternalIds: ReadonlySet<string>
): ClassifiedCsvLeadRow[] {
  const seenInFile = new Set<string>();
  return rows.map((row) => {
    if (isInvalidLead(row.lead)) return { ...row, status: "invalid" as const };

    const id = row.lead.external_id;
    if (id !== null) {
      if (existingExternalIds.has(id) || seenInFile.has(id)) {
        return { ...row, status: "duplicate" as const };
      }
      seenInFile.add(id);
    }
    return { ...row, status: "new" as const };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/form-leads/csv.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/form-leads/csv.ts src/features/form-leads/csv.test.ts
git commit -m "feat(marketing): map and classify CSV leads as new/duplicate/invalid"
```

---

### Task 3: `previewFormLeadsCsv` server action

**Files:**
- Modify: `src/features/form-leads/actions.ts`
- Test: `src/features/form-leads/actions.test.ts` (new)

**Interfaces:**
- Consumes: `parseCsvLeads`, `classifyCsvLeads` from `./csv` (Task 2); existing `requireUser()`, `createSupabaseServiceClient` in `actions.ts`.
- Produces:
  - `previewFormLeadsCsv(csvText: string): Promise<{ ok: true; summary: { total: number; new: number; duplicate: number; invalid: number } } | { error: string }>`
  - Internal (not exported): `classifyCsvText(sb, csvText): Promise<{ rows: ClassifiedCsvLeadRow[] } | { error: string }>` — Task 4 reuses this.

- [ ] **Step 1: Write the failing test**

Create `src/features/form-leads/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getUser = vi.fn(async () => ({ data: { user: { id: "u1" } } }));
const selectIn = vi.fn(async () => ({ data: [], error: null }));
const upsertSelect = vi.fn(async () => ({ data: [], error: null }));
const enqueueStageEvent = vi.fn(async () => ({ queued: true }));
const revalidateTag = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({ in: selectIn }),
      upsert: () => ({ select: upsertSelect }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  }),
}));

vi.mock("@/features/capi/queue", () => ({
  enqueueStageEvent: (...args: unknown[]) => enqueueStageEvent(...args),
}));

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

import { previewFormLeadsCsv } from "./actions";

// l:1 appears twice (in-file duplicate), l:2 has no identity fields, l:3 already exists in
// the DB per `selectIn`'s default mock below.
const CSV = [
  "id,nome_completo,email,telefone,campanha",
  "l:1,Ana,ana@x.com,+5511999999999,Campanha X",
  "l:1,Ana Repetida,ana2@x.com,+5511999999999,Campanha X",
  "l:2,,,,Campanha X",
  "l:3,Bea,bea@x.com,+5511988888888,Campanha X",
].join("\n");

beforeEach(() => {
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  selectIn.mockResolvedValue({ data: [{ external_id: "l:3" }], error: null });
  upsertSelect.mockClear();
  enqueueStageEvent.mockClear();
  revalidateTag.mockClear();
});

describe("previewFormLeadsCsv", () => {
  it("classifies rows without writing anything", async () => {
    const res = await previewFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, summary: { total: 4, new: 1, duplicate: 2, invalid: 1 } });
    expect(upsertSelect).not.toHaveBeenCalled();
    expect(enqueueStageEvent).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await previewFormLeadsCsv(CSV);
    expect(res).toEqual({ error: "Sessão expirada. Entre novamente." });
  });

  it("errors on a file with no data rows", async () => {
    const res = await previewFormLeadsCsv("id,nome_completo\n");
    expect(res).toEqual({ error: "Nenhuma linha encontrada no arquivo." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/form-leads/actions.test.ts`
Expected: FAIL — `previewFormLeadsCsv` is not exported from `./actions` yet.

- [ ] **Step 3: Write minimal implementation**

In `src/features/form-leads/actions.ts`, add the import and the new code (keep the existing `requireUser` and `updateFormLeadStage` as they are):

```ts
import { classifyCsvLeads, parseCsvLeads, type ClassifiedCsvLeadRow } from "./csv";
```

Then append:

```ts
/**
 * Parses and classifies a CSV's leads against what's already in `form_leads`. Shared by
 * previewFormLeadsCsv (which stops here) and commitFormLeadsCsv (which also writes).
 */
async function classifyCsvText(
  sb: ReturnType<typeof createSupabaseServiceClient>,
  csvText: string
): Promise<{ rows: ClassifiedCsvLeadRow[] } | { error: string }> {
  const rows = parseCsvLeads(csvText);
  if (rows.length === 0) return { error: "Nenhuma linha encontrada no arquivo." };

  const ids = [
    ...new Set(rows.map((r) => r.lead.external_id).filter((id): id is string => id !== null)),
  ];

  let existing = new Set<string>();
  if (ids.length > 0) {
    const { data, error } = await sb.from("form_leads").select("external_id").in("external_id", ids);
    if (error) {
      console.error("[form-leads] csv external_id lookup failed", error);
      return { error: "Não foi possível verificar os leads existentes." };
    }
    existing = new Set((data ?? []).map((d) => d.external_id as string));
  }

  return { rows: classifyCsvLeads(rows, existing) };
}

/**
 * Preview a CSV import: how many rows are new, already in the CRM, or unusable. Writes
 * nothing and never touches Meta — that only happens in commitFormLeadsCsv, and only after
 * the user confirms this preview.
 */
export async function previewFormLeadsCsv(
  csvText: string
): Promise<
  | { ok: true; summary: { total: number; new: number; duplicate: number; invalid: number } }
  | { error: string }
> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const classified = await classifyCsvText(sb, csvText);
  if ("error" in classified) return classified;

  const { rows } = classified;
  return {
    ok: true,
    summary: {
      total: rows.length,
      new: rows.filter((r) => r.status === "new").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      invalid: rows.filter((r) => r.status === "invalid").length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/form-leads/actions.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/form-leads/actions.ts src/features/form-leads/actions.test.ts
git commit -m "feat(marketing): previewFormLeadsCsv action, writes nothing"
```

---

### Task 4: `commitFormLeadsCsv` server action

**Files:**
- Modify: `src/features/form-leads/actions.ts`
- Test: `src/features/form-leads/actions.test.ts`

**Interfaces:**
- Consumes: `classifyCsvText` (internal, Task 3); existing `enqueueStageEvent(id: string, stage: string)` from `@/features/capi/queue`.
- Produces: `commitFormLeadsCsv(csvText: string): Promise<{ ok: true; inserted: number; duplicate: number; invalid: number } | { error: string }>`

- [ ] **Step 1: Write the failing test**

Append to `src/features/form-leads/actions.test.ts`:

```ts
import { commitFormLeadsCsv } from "./actions";

describe("commitFormLeadsCsv", () => {
  beforeEach(() => {
    upsertSelect.mockResolvedValue({ data: [{ id: "row-1" }], error: null });
  });

  it("inserts only the new rows and reports each one to Meta", async () => {
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, inserted: 1, duplicate: 2, invalid: 1 });
    expect(enqueueStageEvent).toHaveBeenCalledTimes(1);
    expect(enqueueStageEvent).toHaveBeenCalledWith("row-1", "novo");
    expect(revalidateTag).toHaveBeenCalledWith("form-leads", { expire: 0 });
  });

  it("touches nothing when every row is a duplicate or invalid", async () => {
    selectIn.mockResolvedValue({ data: [{ external_id: "l:1" }, { external_id: "l:3" }], error: null });
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ ok: true, inserted: 0, duplicate: 3, invalid: 1 });
    expect(upsertSelect).not.toHaveBeenCalled();
    expect(enqueueStageEvent).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("rejects when there is no session", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await commitFormLeadsCsv(CSV);
    expect(res).toEqual({ error: "Sessão expirada. Entre novamente." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/form-leads/actions.test.ts`
Expected: FAIL — `commitFormLeadsCsv` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/features/form-leads/actions.ts`:

```ts
/**
 * Commit a previously previewed CSV import: insert the rows classified "new" in one batched
 * upsert, then report each genuinely inserted lead to Meta as "novo" — identical to what the
 * webhook ingest route does for a brand new lead. Rows classified duplicate/invalid are
 * skipped entirely, never updated.
 */
export async function commitFormLeadsCsv(
  csvText: string
): Promise<
  | { ok: true; inserted: number; duplicate: number; invalid: number }
  | { error: string }
> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const classified = await classifyCsvText(sb, csvText);
  if ("error" in classified) return classified;

  const { rows } = classified;
  const toInsert = rows.filter((r) => r.status === "new");

  let insertedIds: string[] = [];
  if (toInsert.length > 0) {
    const { data, error } = await sb
      .from("form_leads")
      .upsert(
        toInsert.map(({ lead }) => ({
          source: "csv_import",
          external_id: lead.external_id,
          sheet_row: null,
          campaign: lead.campaign,
          form_name: lead.form_name,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          raw: lead.raw,
          submitted_at: lead.submitted_at,
        })),
        { onConflict: "external_id", ignoreDuplicates: true }
      )
      .select("id");

    if (error) {
      console.error("[form-leads] csv import failed", error);
      return { error: "Não foi possível importar os leads." };
    }
    insertedIds = (data ?? []).map((d) => d.id as string);
  }

  // Same best-effort stance as updateFormLeadStage: the rows are already committed, and a
  // Meta problem must not turn a successful import into an error the user sees.
  for (const id of insertedIds) {
    const capi = await enqueueStageEvent(id, "novo");
    if (capi.queued && capi.reason) {
      console.warn(`[form-leads] csv import lead ${id}: CAPI event queued (${capi.reason})`);
    }
  }

  if (insertedIds.length > 0) revalidateTag("form-leads", { expire: 0 });

  return {
    ok: true,
    inserted: insertedIds.length,
    duplicate: rows.filter((r) => r.status === "duplicate").length,
    invalid: rows.filter((r) => r.status === "invalid").length,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/form-leads/actions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/form-leads/actions.ts src/features/form-leads/actions.test.ts
git commit -m "feat(marketing): commitFormLeadsCsv action, inserts new rows and reports them to Meta"
```

---

### Task 5: "Importar CSV" button with preview/confirm panel

**Files:**
- Modify: `src/features/form-leads/form-leads-table.tsx`
- Test: `src/features/form-leads/form-leads-table.test.tsx` (new)

**Interfaces:**
- Consumes: `previewFormLeadsCsv`, `commitFormLeadsCsv` from `./actions` (Tasks 3–4); the existing `error` state / `onError` prop pattern already used by `StageSelect` in this file; the existing `confirmBtn` style constant.
- Produces: a `CsvImportButton` component, rendered once inside `FormLeadsTable`'s header row (not exported — internal to this file, same as `StageSelect`/`StageCounts`).

- [ ] **Step 1: Write the failing test**

Create `src/features/form-leads/form-leads-table.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi, test, expect, beforeEach } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const updateFormLeadStage = vi.fn(async () => ({ ok: true as const }));
const previewFormLeadsCsv = vi.fn();
const commitFormLeadsCsv = vi.fn();
vi.mock("./actions", () => ({
  updateFormLeadStage: (...args: unknown[]) => updateFormLeadStage(...args),
  previewFormLeadsCsv: (...args: unknown[]) => previewFormLeadsCsv(...args),
  commitFormLeadsCsv: (...args: unknown[]) => commitFormLeadsCsv(...args),
}));

import { FormLeadsTable } from "./form-leads-table";

beforeEach(() => {
  previewFormLeadsCsv.mockReset();
  commitFormLeadsCsv.mockReset();
});

function pickCsvFile(text: string) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([text], "leads.csv", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

test("shows a preview after picking a file, and only commits on Confirmar", async () => {
  previewFormLeadsCsv.mockResolvedValue({
    ok: true,
    summary: { total: 3, new: 2, duplicate: 1, invalid: 0 },
  });
  commitFormLeadsCsv.mockResolvedValue({ ok: true, inserted: 2, duplicate: 1, invalid: 0 });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\nl:2,Bea\nl:3,Ana\n");

  await waitFor(() => expect(previewFormLeadsCsv).toHaveBeenCalled());
  expect(await screen.findByText(/2 leads novos, 1 já existem, 0 inválidos/)).toBeTruthy();
  expect(commitFormLeadsCsv).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Confirmar"));
  await waitFor(() => expect(commitFormLeadsCsv).toHaveBeenCalled());
  expect(await screen.findByText(/2 leads novos adicionados, 1 já existiam, 0 inválidos/)).toBeTruthy();
});

test("Cancelar clears the preview without committing", async () => {
  previewFormLeadsCsv.mockResolvedValue({
    ok: true,
    summary: { total: 1, new: 1, duplicate: 0, invalid: 0 },
  });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\n");

  await screen.findByText("Confirmar");
  fireEvent.click(screen.getByText("Cancelar"));

  await waitFor(() => expect(screen.queryByText("Confirmar")).toBeNull());
  expect(commitFormLeadsCsv).not.toHaveBeenCalled();
});

test("a preview error surfaces without offering Confirmar", async () => {
  previewFormLeadsCsv.mockResolvedValue({ error: "Sessão expirada. Entre novamente." });

  render(<FormLeadsTable rows={[]} />);
  pickCsvFile("id,nome_completo\nl:1,Ana\n");

  expect(await screen.findByText("Sessão expirada. Entre novamente.")).toBeTruthy();
  expect(screen.queryByText("Confirmar")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/form-leads/form-leads-table.test.tsx`
Expected: FAIL — there's no `input[type="file"]` in the rendered output yet.

- [ ] **Step 3: Write minimal implementation**

In `src/features/form-leads/form-leads-table.tsx`:

1. Add `useRef` to the React import:

```ts
import { useMemo, useRef, useState, useTransition } from "react";
```

2. Add the new actions to the existing import:

```ts
import { commitFormLeadsCsv, previewFormLeadsCsv, updateFormLeadStage } from "./actions";
```

3. Render `<CsvImportButton onError={setError} />` in the header row, right after the leads-count `<span>`:

```tsx
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} leads</span>
          <CsvImportButton onError={setError} />
```

4. Add the component (near `StageSelect`, before `StageCounts`):

```tsx
type CsvSummary = { total: number; new: number; duplicate: number; invalid: number };

function CsvImportButton({ onError }: { onError: (msg: string | null) => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  // Holds the file's text once read, so Confirmar can re-send it to commitFormLeadsCsv
  // without asking the user to pick the file again.
  const [csvText, setCsvText] = useState<string | null>(null);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // clears the input so picking the same file again still fires onChange
    if (!file) return;

    onError(null);
    setResult(null);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      startTransition(async () => {
        const res = await previewFormLeadsCsv(text);
        if ("error" in res) {
          onError(res.error);
          setCsvText(null);
          return;
        }
        setSummary(res.summary);
      });
    };
    reader.readAsText(file);
  }

  function cancel() {
    setCsvText(null);
    setSummary(null);
  }

  function confirm() {
    if (!csvText) return;
    startTransition(async () => {
      const res = await commitFormLeadsCsv(csvText);
      if ("error" in res) {
        onError(res.error);
        return;
      }
      setCsvText(null);
      setSummary(null);
      setResult(
        `${res.inserted} leads novos adicionados, ${res.duplicate} já existiam, ${res.invalid} inválidos.`
      );
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button onClick={() => inputRef.current?.click()} disabled={pending} style={pgBtn}>
          Importar CSV
        </button>
        {result && <span className="muted" style={{ fontSize: 12 }}>{result}</span>}
      </div>

      {summary && (
        <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
          <span>
            {summary.new} leads novos, {summary.duplicate} já existem, {summary.invalid} inválidos (de{" "}
            {summary.total} linhas).
          </span>
          <span style={{ color: "#bf6b6b", fontSize: 11 }}>
            Uma vez confirmado, os novos leads são reportados ao Meta.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={confirm}
              disabled={pending}
              style={{ ...confirmBtn, background: "#6bbf73", color: "#0b0f0d" }}
            >
              Confirmar
            </button>
            <button
              onClick={cancel}
              disabled={pending}
              style={{ ...confirmBtn, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/form-leads/form-leads-table.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full test suite for this feature area**

Run: `npx vitest run src/features/form-leads`
Expected: PASS (all tests across csv.test.ts, actions.test.ts, form-leads-table.test.tsx)

- [ ] **Step 6: Commit**

```bash
git add src/features/form-leads/form-leads-table.tsx src/features/form-leads/form-leads-table.test.tsx
git commit -m "feat(marketing): Importar CSV button with preview/confirm on the leads table"
```
