"use client";
import { useEffect, useRef, useState } from "react";
import type { Gauge } from "./types";

export function Gauges({ gauges }: { gauges: Gauge[] }) {
  const [animPcts, setAnimPcts] = useState<number[]>(gauges.map(() => 0));
  const rafRef = useRef<number>(0);
  const key = gauges.map(g => g.pct).join(",");

  useEffect(() => {
    setAnimPcts(gauges.map(() => 0));
    const targets = gauges.map(g => g.pct);
    const start = performance.now();
    const duration = 700;

    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setAnimPcts(targets.map(target => target * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="grid-4">
      {gauges.map((g, i) => {
        const deg = Math.round(animPcts[i] * 360);
        return (
          <div key={g.key} className="card" style={{ padding: 22, display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: i === 0 ? "inset 0 0 0 1px rgba(217,178,76,.5)" : undefined }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{g.label}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 12px" }}>{g.sub}</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.4px" }}>{g.value}</div>
            </div>
            <div style={{ width: 92, height: 92, borderRadius: "50%", flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(var(--gold) ${deg}deg, #26262b 0)` }}>
              <div style={{ width: 70, height: 70, borderRadius: "50%", background: "#141416", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>{Math.round(animPcts[i] * 100)}%</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
