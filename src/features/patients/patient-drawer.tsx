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
