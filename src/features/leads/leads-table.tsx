"use client";
import { useMemo, useState } from "react";
import type { LeadRow } from "./types";
import { LEAD_COLUMNS, formatLeadCell } from "./columns";
import { LeadDrawer } from "./lead-drawer";

const PAGE = 25;

export function LeadsTable({ rows }: { rows: LeadRow[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<LeadRow | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => [r.name, r.id, r.interest, r.pain_point].some((v) => String(v ?? "").toLowerCase().includes(needle)));
  }, [rows, q]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Pesquisar leads…"
          style={{ flex: 1, maxWidth: 320, padding: "10px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13 }} />
        <span className="muted" style={{ fontSize: 12 }}>{filtered.length} leads</span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>{LEAD_COLUMNS.map((c) => (
              <th key={c.key} style={{ textAlign: "left", padding: "12px 14px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: ".4px", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" }}>{c.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            {pageRows.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)} style={{ cursor: "pointer", borderBottom: "1px solid var(--line)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-hi)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                {LEAD_COLUMNS.map((c) => (
                  <td key={c.key} style={{ padding: "11px 14px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    color: c.key === "name" ? "#fff" : "#cfd2dc", fontWeight: c.key === "name" ? 600 : 400 }}>
                    {formatLeadCell(r, c.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={pgBtn}>← Anterior</button>
        <span className="muted" style={{ fontSize: 12 }}>Página {page + 1} de {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} style={pgBtn}>Próximo →</button>
      </div>
      {selected && <LeadDrawer row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
const pgBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
