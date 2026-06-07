"use client";
import { useEffect, useRef, useState } from "react";
import { formatBRL, formatInt } from "@/lib/format";
import type { Kpi } from "./types";

function AnimatedValue({ value, kind }: { value: number; kind: "currency" | "int" }) {
  const [display, setDisplay] = useState(0);
  const frameRef = useRef(0);
  useEffect(() => {
    const from = frameRef.current;
    const delta = value - from;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + delta * eased;
      frameRef.current = next;
      setDisplay(next);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{kind === "currency" ? formatBRL(display) : formatInt(display)}</>;
}

export function KpiCards({ kpi }: { kpi: Kpi }) {
  const items = [
    { label: "Receita (faturada)", value: kpi.revenueBilled, kind: "currency" as const },
    { label: "Novos pacientes", value: kpi.patients, kind: "int" as const },
    { label: "Vendas", value: kpi.sales, kind: "int" as const },
    { label: "Ticket médio", value: kpi.avgTicket, kind: "currency" as const },
  ];
  return (
    <div className="grid-4">
      {items.map((it) => (
        <div key={it.label} className="card" style={{ padding: "22px 24px", position: "relative", overflow: "hidden", background: "linear-gradient(155deg, #1a1a1e 0%, #0e0e10 100%)", color: "#f5f5f6" }}>
          <div style={{ position: "absolute", right: -30, top: -30, width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(217,178,76,.10), transparent 70%)" }} />
          <div style={{ fontSize: 12, color: "#8c8c95", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>{it.label}</div>
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-.8px", margin: "8px 0 4px", color: "#f5f5f6" }}><AnimatedValue value={it.value} kind={it.kind} /></div>
        </div>
      ))}
    </div>
  );
}
