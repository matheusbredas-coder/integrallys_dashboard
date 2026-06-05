"use client";
import { formatInt } from "@/lib/format";
import type { ProcCount } from "./types";

export function TopProcedures({ rows }: { rows: ProcCount[] }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Procedimentos mais realizados</h3>
      {rows.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Sem procedimentos no período.</div>}
      {rows.map((r, i) => (
        <div key={r.name} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ minWidth: 0, fontSize: 13, color: "#dcdee6", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "var(--muted2)", marginRight: 8 }}>{i + 1}</span>{r.name}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, flex: "none" }}>{formatInt(r.qty)}</div>
        </div>
      ))}
    </div>
  );
}
