import { formatBRL, formatInt } from "@/lib/format";
import type { Kpi } from "./types";

export function KpiCards({ kpi }: { kpi: Kpi }) {
  const items = [
    { label: "Receita (faturada)", value: formatBRL(kpi.revenueBilled), sub: `${formatBRL(kpi.revenueCollected)} recebido · ${formatBRL(kpi.outstanding)} em aberto` },
    { label: "Pacientes", value: formatInt(kpi.patients), sub: `${formatInt(kpi.buyers)} compradores` },
    { label: "Vendas", value: formatInt(kpi.sales), sub: "concluídas" },
    { label: "Ticket médio", value: formatBRL(kpi.avgTicket), sub: "por venda" },
  ];
  return (
    <div className="grid-4">
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
