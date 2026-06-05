# Integrallys CRM — Plan 3: Patients Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A schema-introspected Patients database view — searchable, sortable, paginated table of all patients that **auto-shows any column added to `Clientes`** — plus a detail drawer showing each patient's `gestek_vendas` sales history.

**Architecture:** Query the **base `Clientes` table** (`select *`) so new columns appear automatically. A pure, tested `columns` module turns rows into typed column defs (label/format/sort) — known columns get nice labels/formatters, unknown ones auto-detect. 337 patients + 838 sales fetched server-side; the client table does search/sort/pagination in-browser (instant; scales to a few thousand). The drawer filters pre-loaded sales by patient id.

**Tech Stack:** Next.js 16, TypeScript, Vitest. Reuses `@/lib/format`, theme tokens, `(app)` shell.

**Why base `Clientes` not `clientes_view`:** the view is an explicit SELECT and would NOT include columns the user adds later. The base table's `select *` is what makes the page truly auto-adapt.

## File structure
```
src/features/patients/columns.ts            ← introspection + format/sort (TDD)
src/features/patients/columns.test.ts
src/features/patients/types.ts
src/features/patients/data.ts               ← fetch Clientes(*) + sales, server-only
src/features/patients/patients-table.tsx    ← client: search/sort/paginate/row-click
src/features/patients/patient-drawer.tsx    ← client: fields + sales history
src/app/(app)/patients/page.tsx             ← server page (replaces placeholder)
```

---

## Task 1: Column introspection + format/sort (TDD)

**Files:** Create `src/features/patients/types.ts`, `src/features/patients/columns.ts`, Test `src/features/patients/columns.test.ts`

- [ ] **Step 1: `types.ts`**
```ts
export type Row = Record<string, unknown>;
export type ColType = "text" | "int" | "currency" | "date";
export type ColumnDef = { key: string; label: string; type: ColType };
export type PatientSale = { soldAt: string; total: number; valorPago: number; procedimentos: string };
```

- [ ] **Step 2: failing test `columns.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { buildColumns, formatCell, sortValue } from "./columns";

const rows = [
  { id: "1", "Nome": "ANA", "Receita Total": "2500.00", "Numero de Vendas": "5", "Data do Cadastro": "03/06/26 14:30", segmento: "VIP" },
  { id: "2", "Nome": "BIA", "Receita Total": "", "Numero de Vendas": "0", "Data do Cadastro": "", segmento: "novo" },
];

describe("buildColumns", () => {
  const cols = buildColumns(rows);
  it("labels + types known columns, ordered (Nome first, id last)", () => {
    const byKey = Object.fromEntries(cols.map((c) => [c.key, c]));
    expect(byKey["Nome"]).toEqual({ key: "Nome", label: "Nome", type: "text" });
    expect(byKey["Receita Total"].type).toBe("currency");
    expect(byKey["Numero de Vendas"].type).toBe("int");
    expect(byKey["Data do Cadastro"].type).toBe("date");
    expect(cols[0].key).toBe("Nome");
    expect(cols[cols.length - 1].key).toBe("id");
  });
  it("auto-includes unknown/new columns with humanized label", () => {
    const seg = buildColumns(rows).find((c) => c.key === "segmento");
    expect(seg).toEqual({ key: "segmento", label: "Segmento", type: "text" });
  });
});

describe("formatCell", () => {
  it("formats by type, blanks as dash", () => {
    expect(formatCell("2500.00", "currency")).toBe("R$ 2.500,00");
    expect(formatCell("5", "int")).toBe("5");
    expect(formatCell("03/06/26 14:30", "date")).toBe("03/06/2026");
    expect(formatCell("", "currency")).toBe("—");
    expect(formatCell("VIP", "text")).toBe("VIP");
  });
});

describe("sortValue", () => {
  it("returns comparable values per type", () => {
    expect(sortValue("2500.00", "currency")).toBe(2500);
    expect(sortValue("", "currency")).toBe(-Infinity);
    expect(sortValue("ANA", "text")).toBe("ana");
    expect(typeof sortValue("03/06/26 14:30", "date")).toBe("number");
  });
});
```

- [ ] **Step 3: run → fail** `npm test`.

- [ ] **Step 4: implement `columns.ts`**
```ts
import { formatBRL, formatInt, parseGestekDate, formatDate } from "@/lib/format";
import type { Row, ColType, ColumnDef } from "./types";

const KNOWN: Record<string, { label: string; type: ColType }> = {
  id: { label: "ID", type: "text" },
  Nome: { label: "Nome", type: "text" },
  "Telefone Principal": { label: "Telefone", type: "text" },
  "Email Principal": { label: "Email", type: "text" },
  Origem: { label: "Origem", type: "text" },
  "Data do Cadastro": { label: "Cadastro", type: "date" },
  "Numero de Vendas": { label: "Vendas", type: "int" },
  "Receita Total": { label: "Receita", type: "currency" },
  Descontos: { label: "Descontos", type: "currency" },
  "Ticket Medio": { label: "Ticket médio", type: "currency" },
  Procedimentos: { label: "Procedimentos", type: "text" },
};
const ORDER = ["Nome", "Telefone Principal", "Email Principal", "Origem", "Numero de Vendas",
  "Receita Total", "Ticket Medio", "Descontos", "Data do Cadastro", "Procedimentos", "id"];

function humanize(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function detectType(rows: Row[], key: string): ColType {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (vals.length && vals.every((v) => !isNaN(Number(String(v).trim())))) return "int";
  return "text";
}

export function buildColumns(rows: Row[]): ColumnDef[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 50)) Object.keys(r).forEach((k) => keys.add(k));
  const ordered = [...ORDER.filter((k) => keys.has(k)), ...[...keys].filter((k) => !ORDER.includes(k))];
  return ordered.map((key) => {
    const known = KNOWN[key];
    return known ? { key, label: known.label, type: known.type } : { key, label: humanize(key), type: detectType(rows, key) };
  });
}

function asDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return parseGestekDate(s) ?? (isNaN(Date.parse(s)) ? null : new Date(s));
}

export function formatCell(v: unknown, type: ColType): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.trim() === "") return "—";
  if (type === "currency") return formatBRL(s);
  if (type === "int") return formatInt(s);
  if (type === "date") { const d = asDate(s); return d ? formatDate(d) : s; }
  return s;
}

export function sortValue(v: unknown, type: ColType): number | string {
  const s = String(v ?? "").trim();
  if (type === "text") return s.toLowerCase();
  if (type === "date") { const d = asDate(s); return d ? d.getTime() : -Infinity; }
  if (s === "") return -Infinity;
  const n = Number(s);
  return isNaN(n) ? -Infinity : n;
}
```

- [ ] **Step 5: run → pass** `npm test`. **Commit** `feat: patients column introspection (TDD)`.

---

## Task 2: Server data fetch

**Files:** Create `src/features/patients/data.ts`

- [ ] **Step 1: implement**
```ts
import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { Row, PatientSale } from "./types";

export async function getPatientsData(): Promise<{ patients: Row[]; salesByPatient: Record<string, PatientSale[]> }> {
  const sb = createSupabaseServiceClient();
  const [pRes, vRes] = await Promise.all([
    sb.from("Clientes").select("*"),
    sb.from("vendas_view").select("sold_at, cliente_supabase_id, total, valor_pago, procedimentos").order("sold_at", { ascending: false }),
  ]);
  if (pRes.error) throw pRes.error;
  if (vRes.error) throw vRes.error;

  const salesByPatient: Record<string, PatientSale[]> = {};
  for (const v of vRes.data ?? []) {
    const k = String(v.cliente_supabase_id ?? "");
    if (!k) continue;
    (salesByPatient[k] ??= []).push({ soldAt: v.sold_at, total: Number(v.total) || 0, valorPago: Number(v.valor_pago) || 0, procedimentos: v.procedimentos ?? "—" });
  }
  return { patients: (pRes.data ?? []) as Row[], salesByPatient };
}
```

- [ ] **Step 2: `npx tsc --noEmit`** → clean. **Commit** `feat: patients data fetch (Clientes + sales)`.

---

## Task 3: Patients table (client component)

**Files:** Create `src/features/patients/patients-table.tsx`

Requirements: a `.card`-wrapped panel with a search input (filters across all cells, case-insensitive), clickable sortable column headers (toggle asc/desc using `sortValue` per the column type), 25/page pagination, and row click → opens the drawer. Uses theme tokens; muted header row, hover row highlight, gold active-sort caret. Truncate long cells. Receives `columns: ColumnDef[]`, `rows: Row[]`, `salesByPatient`. Maintains drawer state and renders `<PatientDrawer>`.

- [ ] **Step 1: implement `patients-table.tsx`** (`"use client"`). Key logic:
```tsx
"use client";
import { useMemo, useState } from "react";
import type { Row, ColumnDef, PatientSale } from "./types";
import { formatCell, sortValue } from "./columns";
import { PatientDrawer } from "./patient-drawer";

const PAGE = 25;

export function PatientsTable({ columns, rows, salesByPatient }: { columns: ColumnDef[]; rows: Row[]; salesByPatient: Record<string, PatientSale[]> }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string>("Nome");
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Row | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = !needle ? rows : rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(needle)));
    const col = columns.find((c) => c.key === sortKey);
    const type = col?.type ?? "text";
    return [...base].sort((a, b) => {
      const av = sortValue(a[sortKey], type), bv = sortValue(b[sortKey], type);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [rows, q, sortKey, dir, columns]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const onSort = (k: string) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(1); } setPage(0); };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search patients…"
          style={{ flex: 1, maxWidth: 320, padding: "10px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13 }} />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} patients</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>{columns.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)} style={{ textAlign: "left", padding: "12px 14px", color: "var(--muted)", fontWeight: 600,
                textTransform: "uppercase", fontSize: 11, letterSpacing: ".4px", cursor: "pointer", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" }}>
                {c.label}{sortKey === c.key ? <span style={{ color: "var(--gold)" }}>{dir === 1 ? " ▲" : " ▼"}</span> : ""}
              </th>))}</tr>
          </thead>
          <tbody>
            {pageRows.map((r, i) => (
              <tr key={i} onClick={() => setSelected(r)} style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-hi)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: "11px 14px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: c.key === "Nome" ? "#fff" : "#cfd2dc", fontWeight: c.key === "Nome" ? 600 : 400 }}>
                    {formatCell(r[c.key], c.type)}
                  </td>))}
              </tr>))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="muted" style={pgBtn}>← Prev</button>
        <span className="muted" style={{ fontSize: 12 }}>Page {page + 1} / {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="muted" style={pgBtn}>Next →</button>
      </div>
      {selected && <PatientDrawer row={selected} columns={columns} sales={salesByPatient[String(selected["id"] ?? "")] ?? []} onClose={() => setSelected(null)} />}
    </div>
  );
}
const pgBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
```

- [ ] **Step 2: `npx tsc --noEmit`** → clean. **Commit** `feat: patients table (search/sort/paginate)`.

---

## Task 4: Patient detail drawer (client component)

**Files:** Create `src/features/patients/patient-drawer.tsx`

Slide-in panel from the right: dimmed backdrop (click closes), patient name header, all fields as label/value pairs (using `formatCell`), then a "Sales history" section listing the patient's sales (date, procedimentos, total, valor_pago) with a total. Theme tokens; width ~440px; `position: fixed`.

- [ ] **Step 1: implement**
```tsx
"use client";
import type { Row, ColumnDef, PatientSale } from "./types";
import { formatCell } from "./columns";
import { formatBRL } from "@/lib/format";

function shortDate(iso: string) { const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`; }

export function PatientDrawer({ row, columns, sales, onClose }: { row: Row; columns: ColumnDef[]; sales: PatientSale[]; onClose: () => void }) {
  const name = String(row["Nome"] ?? "Patient");
  const totalBilled = sales.reduce((a, s) => a + s.total, 0);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "92vw", background: "#0e0e10", borderLeft: "1px solid var(--line)", zIndex: 41, overflowY: "auto", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.4px" }}>{name}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 2, marginBottom: 24 }}>
          {columns.filter((c) => c.key !== "Nome").map((c) => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{c.label}</span>
              <span style={{ fontSize: 13, textAlign: "right", maxWidth: 260, overflowWrap: "anywhere" }}>{formatCell(row[c.key], c.type)}</span>
            </div>))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700 }}>Sales history</h3>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>{formatBRL(totalBilled)} · {sales.length}</span>
        </div>
        {sales.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No sales recorded.</p>}
        {sales.map((s, i) => (
          <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{shortDate(s.soldAt)}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)" }}>{formatBRL(s.total)}</span>
            </div>
            <div style={{ fontSize: 12.5, color: "#cfd2dc", marginTop: 3 }}>{s.procedimentos}</div>
          </div>))}
      </aside>
    </>
  );
}
```

- [ ] **Step 2: `npx tsc --noEmit`** → clean. **Commit** `feat: patient detail drawer with sales history`.

---

## Task 5: Wire page + live verify

**Files:** Modify `src/app/(app)/patients/page.tsx`

- [ ] **Step 1: implement**
```tsx
import { getPatientsData } from "@/features/patients/data";
import { buildColumns } from "@/features/patients/columns";
import { PatientsTable } from "@/features/patients/patients-table";

export default async function PatientsPage() {
  const { patients, salesByPatient } = await getPatientsData();
  const columns = buildColumns(patients);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Patients</h1>
      <PatientsTable columns={columns} rows={patients} salesByPatient={salesByPatient} />
    </div>
  );
}
```

- [ ] **Step 2: `npm test && npm run build`** (disable sandbox) → green.
- [ ] **Step 3: Live verify (controller, Playwright):** log in → `/patients`. Confirm: table shows ~337 rows w/ columns (Nome, Telefone, …, Receita formatted as BRL), search filters, a column sort reorders, clicking a row opens the drawer with the patient's sales history. Screenshot table + drawer. No console errors.
- [ ] **Step 4: Commit** `feat: assemble Patients page`.

---

## Self-Review
- [ ] **Spec coverage:** schema-introspected table from base `Clientes` (auto-new-columns) ✓ T1/T2; search/sort/paginate ✓ T3; detail drawer w/ sales ✓ T4; wired + verified ✓ T5.
- [ ] **Placeholder scan:** logic (T1) full TDD; components full code.
- [ ] **Type consistency:** `Row`/`ColumnDef`/`ColType`/`PatientSale` from `types.ts`; `buildColumns`/`formatCell`/`sortValue` signatures stable across tasks; `getPatientsData()` shape consumed in page + table.

## Next: Plan 4 (text-to-SQL chat) — wires the Ask bar; needs the read-only role (005).
