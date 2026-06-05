"use client";
import type { Gauge } from "./types";

export function Gauges({ gauges }: { gauges: Gauge[] }) {
  return (
    <div className="grid-4">
      {gauges.map((g, i) => {
        const deg = Math.round(g.pct * 360);
        return (
          <div key={g.key} className="card" style={{ padding: 22, display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: i === 0 ? "inset 0 0 0 1px rgba(217,178,76,.5)" : undefined }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{g.label}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 12px" }}>{g.sub}</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.4px" }}>{g.value}</div>
            </div>
            <div style={{ width: 92, height: 92, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(var(--gold) ${deg}deg, #26262b 0)` }}>
              <div style={{ width: 70, height: 70, borderRadius: "50%", background: "#141416", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{Math.round(g.pct * 100)}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
