"use client";
import { useEffect, useState } from "react";
import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { RevenuePoint } from "./types";

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [chartData, setChartData] = useState<RevenuePoint[]>([]);
  useEffect(() => {
    setChartData([]);
    const id = setTimeout(() => setChartData(data), 0);
    return () => clearTimeout(id);
  }, [data]);

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Receita no período</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={chartData}>
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f0d488" /><stop offset="100%" stopColor="#9a7b2e" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26262b" vertical={false} />
          <XAxis dataKey="label" stroke="#8c8c95" fontSize={11} />
          <YAxis stroke="#8c8c95" fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={{ background: "#141416", border: "1px solid #26262b", borderRadius: 12 }} labelStyle={{ color: "#f5f5f6" }}
            formatter={(v: ValueType | undefined) => v == null ? "" : `R$ ${Math.round(Number(v)).toLocaleString("pt-BR")}`} />
          <Bar dataKey="revenue" radius={[6, 6, 2, 2]} fill="url(#gold)" isAnimationActive animationDuration={700} animationEasing="ease-out" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
