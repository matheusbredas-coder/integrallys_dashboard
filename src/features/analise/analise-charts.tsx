"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { formatUsd } from "./aggregate";
import type { ChartPoint, CostPoint } from "./types";

// Mesmas cores fixas do gráfico de receita da Visão Geral, para os dois lerem como um só
// painel. O eixo e a grade ficam recessivos de propósito: quem tem que saltar é a barra.
const GRID = "#26262b";
const AXIS = "#8c8c95";

const tooltipStyle = { background: "#141416", border: "1px solid #26262b", borderRadius: 12 } as const;
const tooltipLabelStyle = { color: "#f5f5f6" } as const;

/**
 * Replica a animação de entrada a cada troca de período: sem o passo pelo array vazio o
 * recharts interpola das barras antigas para as novas e o gráfico parece não ter mudado.
 * Mesmo truque de `overview/revenue-chart.tsx`.
 */
function useReplayedData<T>(data: T[]): T[] {
  const [replayed, setReplayed] = useState<T[]>([]);
  useEffect(() => {
    setReplayed([]);
    const id = setTimeout(() => setReplayed(data), 0);
    return () => clearTimeout(id);
  }, [data]);
  return replayed;
}

function Frame({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={260}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

/** Série única — o título já diz o que é, então não há legenda a acrescentar. */
export function TrafficChart({ data }: { data: ChartPoint[] }) {
  const chartData = useReplayedData(data);
  return (
    <Frame title="Visitas por dia">
      <BarChart data={chartData}>
        <defs>
          <linearGradient id="analise-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0d488" />
            <stop offset="100%" stopColor="#9a7b2e" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} fontSize={11} minTickGap={16} />
        <YAxis stroke={AXIS} fontSize={11} allowDecimals={false} />
        <Tooltip
          cursor={{ fill: "rgba(217,178,76,.08)" }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          formatter={(v: ValueType | undefined) => (v == null ? "" : [`${Number(v).toLocaleString("pt-BR")}`, "Visitas"])}
        />
        <Bar dataKey="sessions" radius={[4, 4, 0, 0]} fill="url(#analise-gold)" isAnimationActive animationDuration={700} animationEasing="ease-out" />
      </BarChart>
    </Frame>
  );
}

export function CostChart({ data }: { data: CostPoint[] }) {
  const chartData = useReplayedData(data);
  return (
    <Frame title="Gasto por dia (US$)">
      <BarChart data={chartData}>
        <defs>
          <linearGradient id="analise-gold-cost" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f0d488" />
            <stop offset="100%" stopColor="#9a7b2e" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} fontSize={11} minTickGap={16} />
        <YAxis stroke={AXIS} fontSize={11} width={64} tickFormatter={(v: number) => formatUsd(v)} />
        <Tooltip
          cursor={{ fill: "rgba(217,178,76,.08)" }}
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          formatter={(v: ValueType | undefined) => (v == null ? "" : [formatUsd(Number(v)), "Gasto"])}
        />
        <Bar dataKey="usd" radius={[4, 4, 0, 0]} fill="url(#analise-gold-cost)" isAnimationActive animationDuration={700} animationEasing="ease-out" />
      </BarChart>
    </Frame>
  );
}
