"use client";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { MonthPoint } from "./types";

export function RevenueChart({ data }: { data: MonthPoint[] }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>Monthly revenue</h3>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data}>
          <defs>
            <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f0d488" /><stop offset="100%" stopColor="#9a7b2e" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#26262b" vertical={false} />
          <XAxis dataKey="month" tickFormatter={(m: string) => m.slice(5)} stroke="#8c8c95" fontSize={11} />
          <YAxis stroke="#8c8c95" fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
          <Tooltip contentStyle={{ background: "#141416", border: "1px solid #26262b", borderRadius: 12 }} labelStyle={{ color: "#f5f5f6" }}
            formatter={(v: ValueType | undefined) => v == null ? "" : `R$ ${Math.round(Number(v)).toLocaleString("pt-BR")}`} />
          <Bar dataKey="revenue" radius={[6, 6, 2, 2]} fill="url(#gold)" />
          <Line dataKey="collected" stroke="#74cfc0" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
