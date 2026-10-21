"use client";

import { useMemo, useState, startTransition } from "react";
import { PeriodPicker } from "@/features/overview/period-picker";
import { rangeForPreset } from "@/features/overview/timeframe";
import type { DateRange, Timeframe } from "@/features/overview/types";
import { formatInt } from "@/lib/format";
import { TrafficChart, CostChart } from "./analise-charts";
import {
  buildChart,
  buildCostChart,
  formatUsd,
  rankChannels,
  rankDevices,
  rankModels,
  sumCost,
  sumTraffic,
  topPages,
} from "./aggregate";
import { WINDOW_DAYS } from "./constants";
import type { AnaliseSource, Block, CostSource, RankedPage, RankedSlice, TrafficSource } from "./types";

const tileStyle: React.CSSProperties = {
  padding: "14px 16px",
  borderRadius: 14,
  background: "var(--panel-hi)",
  border: "1px solid var(--line)",
  flex: 1,
  minWidth: 130,
};

function Tiles({ items }: { items: { label: string; value: string; sub?: string }[] }) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {items.map((t) => (
        <div key={t.label} style={tileStyle}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{t.value}</div>
          <div className="muted" style={{ fontSize: 12 }}>{t.label}</div>
          {t.sub ? <div className="muted" style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{t.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Uma lista ordenada com barra de proporção, em vez de pizza: com poucas fatias a pizza
 * esconde a ordem e obriga a ler a legenda. A cor é uma só — quem identifica a linha é o
 * texto, não o tom.
 */
function RankedBars({ title, rows, empty }: { title: string; rows: RankedSlice[]; empty: string }) {
  const max = rows[0]?.sessions ?? 0;
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>{empty}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {rows.map((row) => (
            <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                <span style={{ fontWeight: 600 }}>{row.label}</span>
                <span className="muted" style={{ flex: "none" }}>
                  {formatInt(row.sessions)} · {Math.round(row.share)}%
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${max > 0 ? (row.sessions / max) * 100 : 0}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg,#9a7b2e,#f0d488)",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopPages({ rows }: { rows: RankedPage[] }) {
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Páginas mais vistas</h3>
      {rows.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem visualizações no período.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => (
            <div key={row.path} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.path}>
                {row.path}
              </span>
              <span className="muted" style={{ flex: "none" }}>{formatInt(row.views)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Uma fonte fora do ar vira um aviso com o que fazer, e não uma página em branco. */
function SourceError({ title, error }: { title: string; error: string }) {
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
      <p style={{ fontSize: 13, margin: 0, color: "#e5a53a" }}>{error}</p>
      <p className="muted" style={{ fontSize: 12, margin: 0 }}>
        O resto da página continua funcionando normalmente.
      </p>
    </div>
  );
}

/**
 * Cabeçalho no mesmo formato das outras seções do /marketing (`<h2>` de 18px, margem
 * "8px 0 0"), para a análise não parecer um bloco colado de outro lugar.
 */
function SectionTitle({
  children,
  note,
  aside,
}: {
  children: React.ReactNode;
  note?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", margin: "8px 0 0" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{children}</h2>
        {note ? <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>{note}</p> : null}
      </div>
      {aside}
    </div>
  );
}

function TrafficSection({ block, range }: { block: Block<TrafficSource>; range: DateRange }) {
  const view = useMemo(() => {
    if (!block.ok) return null;
    return {
      totals: sumTraffic(block.data.daily, range),
      chart: buildChart(block.data.daily, range),
      channels: rankChannels(block.data.channels, range),
      devices: rankDevices(block.data.devices, range),
      pages: topPages(block.data.pages, range),
    };
  }, [block, range]);

  if (!block.ok) return <SourceError title="Site" error={block.error} />;
  if (!view) return null;

  return (
    <>
      <Tiles
        items={[
          { label: "Visitas", value: formatInt(view.totals.sessions) },
          { label: "Pessoas", value: formatInt(view.totals.users), sub: "somadas por dia" },
          { label: "Páginas vistas", value: formatInt(view.totals.views) },
        ]}
      />
      <TrafficChart data={view.chart} />
      <div className="grid-2">
        <RankedBars title="De onde vieram" rows={view.channels} empty="Sem visitas no período." />
        <RankedBars title="Em que aparelho" rows={view.devices} empty="Sem visitas no período." />
      </div>
      <TopPages rows={view.pages} />
    </>
  );
}

function CostSection({ block, range }: { block: Block<CostSource>; range: DateRange }) {
  const view = useMemo(() => {
    if (!block.ok) return null;
    return {
      total: sumCost(block.data.daily, range),
      chart: buildCostChart(block.data.daily, range),
      models: rankModels(block.data.byModel, range),
    };
  }, [block, range]);

  if (!block.ok) return <SourceError title="Custo da API do Claude" error={block.error} />;
  if (!view) return null;

  const days = view.chart.length;
  return (
    <>
      <Tiles
        items={[
          { label: "Gasto no período", value: formatUsd(view.total) },
          { label: "Média por dia", value: formatUsd(days > 0 ? view.total / days : 0) },
        ]}
      />
      <CostChart data={view.chart} />
      <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Por modelo</h3>
        {view.models.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Sem gasto no período.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {view.models.map((m) => (
              <div key={m.model} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.model}</span>
                <span className="muted" style={{ flex: "none" }}>
                  {formatUsd(m.usd)} · {Math.round(m.share)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * As seções de análise do /marketing. Devolve um fragmento em vez de um contêiner próprio,
 * para as seções entrarem direto na coluna da página e herdarem o mesmo espaçamento das
 * outras — do contrário a análise ficaria com um respiro diferente do resto.
 *
 * O seletor de período fica colado no primeiro cabeçalho de propósito: ele governa só estes
 * blocos, e o resto do /marketing não tem noção de período nenhuma.
 */
export function AnalisePanel({ source }: { source: AnaliseSource }) {
  const now = useMemo(() => new Date(source.nowIso), [source.nowIso]);
  const [period, setPeriod] = useState<{ range: DateRange; presetKey: Timeframe | null }>(() => ({
    range: rangeForPreset(now, "month"),
    presetKey: "month",
  }));

  return (
    <>
      <SectionTitle
        note={`integrallysestetica.com.br, medido pelo Google Analytics. Últimos ${WINDOW_DAYS} dias.`}
        aside={
          <PeriodPicker
            range={period.range}
            presetKey={period.presetKey}
            now={now}
            onApply={(range, presetKey) => startTransition(() => setPeriod({ range, presetKey }))}
          />
        }
      >
        Visitas no site
      </SectionTitle>
      <TrafficSection block={source.traffic} range={period.range} />

      <SectionTitle note="Inclui TUDO que usa a chave: o bot em produção, os testes locais e os scripts. Não é só o gasto da clínica.">
        Custo da API do Claude
      </SectionTitle>
      <CostSection block={source.cost} range={period.range} />
    </>
  );
}
