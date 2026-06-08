"use client";
import { useMemo, useState } from "react";
import type { Row, ColumnDef, PatientSale } from "./types";
import { formatCell, sortValue } from "./columns";
import { PatientDrawer } from "./patient-drawer";

const PAGE = 25;

export function PatientsTable({ columns, rows, salesByPatient }: { columns: ColumnDef[]; rows: Row[]; salesByPatient: Record<string, PatientSale[]> }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string>("Nome");
  const [dir, setDir] = useState<1 | -1>(-1);
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
  const onSort = (k: string) => { if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setDir(-1); } setPage(0); };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Pesquisar pacientes…"
          style={{ flex: 1, maxWidth: 320, padding: "10px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13 }} />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} pacientes</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>{columns.map((c) => (
              <th key={c.key} onClick={() => onSort(c.key)} style={{ textAlign: "left", padding: "12px 14px", color: "var(--muted)", fontWeight: 600,
                textTransform: "uppercase", fontSize: 11, letterSpacing: ".4px", cursor: "pointer", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" }}>
                {c.label}{sortKey === c.key ? <span style={{ color: "var(--gold)" }}>{dir === -1 ? " ▲" : " ▼"}</span> : ""}
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
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={pgBtn}>← Anterior</button>
        <span className="muted" style={{ fontSize: 12 }}>Página {page + 1} de {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} style={pgBtn}>Próximo →</button>
      </div>
      {selected && <PatientDrawer row={selected} columns={columns} sales={salesByPatient[String(selected["id"] ?? "")] ?? []} onClose={() => setSelected(null)} />}
    </div>
  );
}
const pgBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
