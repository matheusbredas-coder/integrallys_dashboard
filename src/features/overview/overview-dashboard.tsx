"use client";

import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import { SyncButton } from "@/features/sync/sync-button";
import { KpiCards } from "./kpi-cards";
import { Gauges } from "./gauges";
import { RevenueChart } from "./revenue-chart";
import { TopProcedures } from "./top-procedures";
import { buildOverviewSlice, TIMEFRAME_LABELS } from "./timeframe";
import type { OverviewSource, Timeframe } from "./types";

const OPTIONS: { value: Timeframe; label: string; helper: string }[] = [
  { value: "today", label: "Hoje", helper: "Até agora" },
  { value: "week", label: "Semana", helper: "Semana atual" },
  { value: "month", label: "Mês", helper: "Mês atual" },
  { value: "year", label: "Ano", helper: "Ano atual" },
];

export function OverviewDashboard({ source, syncEnabled }: { source: OverviewSource; syncEnabled: boolean }) {
  const [timeframe, setTimeframe] = useState<Timeframe>("month");
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!menuRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (!open && menuMounted) {
      closeTimer.current = setTimeout(() => setMenuMounted(false), 180);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, menuMounted]);

  const slice = useMemo(() => buildOverviewSlice(source, timeframe), [source, timeframe]);

  const closeMenu = () => {
    setOpen(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Olá, Matheus</h1>
          <p className="muted" style={{ marginTop: 4 }}>Aqui está um resumo da sua clínica.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, minWidth: 240 }}>
          <SyncButton enabled={syncEnabled} />
          <div ref={menuRef} className="timeframe-picker">
            <button
              type="button"
              className="timeframe-trigger"
              onClick={() => {
                setMenuMounted(true);
                setOpen((v) => !v);
              }}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <span>
                <span className="timeframe-kicker">Período</span>
                <strong>{TIMEFRAME_LABELS[timeframe]}</strong>
              </span>
              <Chevron open={open} />
            </button>
            {menuMounted && (
              <div className={`timeframe-menu${open ? " open" : " closing"}`} role="menu" aria-label="Selecionar período">
                {OPTIONS.map((opt) => {
                  const active = opt.value === timeframe;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      className={`timeframe-option${active ? " active" : ""}`}
                      onClick={() => {
                        startTransition(() => setTimeframe(opt.value));
                        closeMenu();
                      }}
                    >
                      <span>{opt.label}</span>
                      <small>{opt.helper}</small>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <KpiCards kpi={slice.kpi} />
      <Gauges gauges={slice.gauges} />
      <RevenueChart data={slice.chart} />
      <TopProcedures rows={slice.topProcedures} />
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform .2s ease" }}>
      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
