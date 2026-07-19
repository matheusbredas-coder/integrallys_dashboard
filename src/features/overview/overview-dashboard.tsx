"use client";

import { useMemo, useState, startTransition } from "react";
import { SyncButton } from "@/features/sync/sync-button";
import { KpiCards } from "./kpi-cards";
import { Gauges } from "./gauges";
import { RevenueChart } from "./revenue-chart";
import { ChatPanel } from "@/features/chat/chat-panel";
import { TopProcedures } from "./top-procedures";
import { RecentSales } from "./recent-sales";
import { PeriodPicker } from "./period-picker";
import { buildOverviewSlice, rangeForPreset } from "./timeframe";
import type { DateRange, LastSync, OverviewSource, Timeframe } from "./types";

// Freshness stamp under the sync button. The dead-cron incident showed the dashboard
// silently drifting days stale — staleness must be visible, not inferred from missing sales.
const STALE_AFTER_MS = 26 * 60 * 60 * 1000; // nightly cadence + slack for Vercel's imprecise cron

function LastSyncNote({ lastSync, now }: { lastSync: LastSync | null; now: Date }) {
  if (!lastSync) return null;
  const { lastOkAt, lastError } = lastSync;
  const stale = !lastOkAt || now.getTime() - new Date(lastOkAt).getTime() > STALE_AFTER_MS;
  const when = lastOkAt
    ? new Date(lastOkAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "nunca";
  const warn = stale || !!lastError;
  return (
    <span className={warn ? undefined : "muted"} style={{ fontSize: 11, color: warn ? "#e5a53a" : undefined }} title={lastError ?? undefined}>
      Última sincronização: {when}
      {lastError ? " · última tentativa falhou" : stale ? " · desatualizado" : ""}
    </span>
  );
}

export function OverviewDashboard({ source, syncEnabled, firstName }: { source: OverviewSource; syncEnabled: boolean; firstName: string }) {
  const now = useMemo(() => new Date(source.nowIso), [source.nowIso]);
  const [period, setPeriod] = useState<{ range: DateRange; presetKey: Timeframe | null }>(() => ({
    range: rangeForPreset(now, "month"),
    presetKey: "month",
  }));

  const slice = useMemo(() => buildOverviewSlice(source, period.range, period.presetKey), [source, period.range, period.presetKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Olá, {firstName}</h1>
          <p className="muted" style={{ marginTop: 4 }}>Aqui está um resumo da sua clínica.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, minWidth: 240, marginLeft: "auto" }}>
          <SyncButton enabled={syncEnabled} />
          <LastSyncNote lastSync={source.lastSync} now={now} />
          <PeriodPicker
            range={period.range}
            presetKey={period.presetKey}
            now={now}
            onApply={(range, presetKey) => startTransition(() => setPeriod({ range, presetKey }))}
          />
        </div>
      </div>

      <KpiCards kpi={slice.kpi} />
      <Gauges gauges={slice.gauges} />
      <RevenueChart data={slice.chart} />
      <ChatPanel />
      <TopProcedures rows={slice.topProcedures} />
      <RecentSales rows={slice.recentSales} />
    </div>
  );
}
