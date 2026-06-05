import { formatBRL } from "@/lib/format";
import type { RecentSale } from "./types";

function shortDate(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
}

export function RecentSales({ rows }: { rows: RecentSale[] }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Vendas recentes</h3>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", width: 42, flex: "none" }}>{shortDate(r.soldAt)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.patient}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.procedimentos}</div>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold)", flex: "none" }}>{formatBRL(r.total)}</div>
        </div>
      ))}
    </div>
  );
}
