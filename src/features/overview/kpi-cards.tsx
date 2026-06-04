import { formatBRL, formatInt } from "@/lib/format";
import type { Kpi } from "./types";

export function KpiCards({ kpi }: { kpi: Kpi }) {
  const items = [
    { label: "Revenue (billed)", value: formatBRL(kpi.revenueBilled), sub: `${formatBRL(kpi.revenueCollected)} collected · ${formatBRL(kpi.outstanding)} open` },
    { label: "Patients", value: formatInt(kpi.patients), sub: `${formatInt(kpi.buyers)} buyers` },
    { label: "Sales", value: formatInt(kpi.sales), sub: "completed" },
    { label: "Avg ticket", value: formatBRL(kpi.avgTicket), sub: "per sale" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 18 }}>
      {items.map((it) => (
        <div key={it.label} className="card" style={{ padding: "22px 24px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(217,178,76,.10), transparent 70%)" }} />
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{it.label}</div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-.8px", margin: "8px 0 4px" }}>{it.value}</div>
          <div style={{ fontSize: 12, color: "var(--muted2)", fontWeight: 500 }}>{it.sub}</div>
        </div>
      ))}
    </div>
  );
}
