"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRESET_LABELS, firstOfMonth, formatRangeLabel, rangeForPreset, todayKey } from "./timeframe";
import type { DateRange, Timeframe } from "./types";

const PRESETS: Timeframe[] = ["today", "week", "month", "year"];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"]; // Dom Seg Ter Qua Qui Sex Sáb (Sunday-start)
const monthTitleFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", month: "long", year: "numeric" });

function utcDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function daysInMonth(view: Date): number {
  return new Date(Date.UTC(view.getUTCFullYear(), view.getUTCMonth() + 1, 0)).getUTCDate();
}

function addMonths(view: Date, delta: number): Date {
  return new Date(Date.UTC(view.getUTCFullYear(), view.getUTCMonth() + delta, 1));
}

export function PeriodPicker({
  range,
  presetKey,
  now,
  onApply,
}: {
  range: DateRange;
  presetKey: Timeframe | null;
  now: Date;
  onApply: (range: DateRange, presetKey: Timeframe | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuMounted, setMenuMounted] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(() => firstOfMonth(range.end));
  const [draftStart, setDraftStart] = useState<Date | null>(range.start);
  const [draftEnd, setDraftEnd] = useState<Date | null>(range.end);
  const [hover, setHover] = useState<Date | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = useMemo(() => todayKey(now), [now]);
  const maxMonth = useMemo(() => firstOfMonth(today), [today]);

  // Seed the draft from the active range each time the popup opens.
  const openPicker = () => {
    setDraftStart(range.start);
    setDraftEnd(range.end);
    setViewMonth(firstOfMonth(range.end));
    setHover(null);
    setMenuMounted(true);
    setOpen(true);
  };

  useEffect(() => {
    const onDown = (ev: MouseEvent) => {
      if (!rootRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (!open && menuMounted) {
      closeTimer.current = setTimeout(() => setMenuMounted(false), 180);
    }
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [open, menuMounted]);

  const triggerLabel = presetKey ? PRESET_LABELS[presetKey] : formatRangeLabel(range);

  const grid = useMemo(() => {
    const first = firstOfMonth(viewMonth);
    const lead = first.getUTCDay(); // 0 = Sunday
    const count = daysInMonth(viewMonth);
    const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let d = 1; d <= count; d++) cells.push(utcDay(viewMonth.getUTCFullYear(), viewMonth.getUTCMonth(), d));
    return cells;
  }, [viewMonth]);

  // Effective selection for highlighting — previews the hovered range while picking the end.
  const sel = useMemo(() => {
    if (draftStart && draftEnd) return { start: draftStart.getTime(), end: draftEnd.getTime() };
    if (draftStart && hover) {
      const a = draftStart.getTime();
      const b = hover.getTime();
      return { start: Math.min(a, b), end: Math.max(a, b) };
    }
    if (draftStart) return { start: draftStart.getTime(), end: draftStart.getTime() };
    return null;
  }, [draftStart, draftEnd, hover]);

  const applyPreset = (key: Timeframe) => {
    onApply(rangeForPreset(now, key), key);
    setOpen(false);
  };

  const onDayClick = (day: Date) => {
    if (day.getTime() > today.getTime()) return; // no future
    if (!draftStart || draftEnd) {
      setDraftStart(day);
      setDraftEnd(null);
      return;
    }
    if (day.getTime() < draftStart.getTime()) {
      setDraftEnd(draftStart);
      setDraftStart(day);
    } else {
      setDraftEnd(day);
    }
  };

  const apply = () => {
    if (!draftStart) return;
    onApply({ start: draftStart, end: draftEnd ?? draftStart }, null);
    setOpen(false);
  };

  const monthTitle = (() => {
    const t = monthTitleFmt.format(viewMonth);
    return t.charAt(0).toUpperCase() + t.slice(1);
  })();

  return (
    <div ref={rootRef} className="timeframe-picker">
      <button
        type="button"
        className="timeframe-trigger"
        onClick={() => (open ? setOpen(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span>
          <span className="timeframe-kicker">Período</span>
          <strong>{triggerLabel}</strong>
        </span>
        <Chevron open={open} />
      </button>

      {menuMounted && (
        <div className={`timeframe-menu period-menu${open ? " open" : " closing"}`} role="dialog" aria-label="Selecionar período">
          <div className="period-chips">
            {PRESETS.map((key) => (
              <button
                key={key}
                type="button"
                className={`period-chip${presetKey === key ? " active" : ""}`}
                onClick={() => applyPreset(key)}
              >
                {PRESET_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="period-cal-head">
            <button type="button" className="period-nav" aria-label="Mês anterior" onClick={() => setViewMonth((m) => addMonths(m, -1))}>
              ‹
            </button>
            <span className="period-month">{monthTitle}</span>
            <button
              type="button"
              className="period-nav"
              aria-label="Próximo mês"
              disabled={viewMonth.getTime() >= maxMonth.getTime()}
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              ›
            </button>
          </div>

          <div className="period-weekdays">
            {WEEKDAYS.map((w, i) => (
              <span key={i}>{w}</span>
            ))}
          </div>

          <div className="period-grid" onMouseLeave={() => setHover(null)}>
            {grid.map((day, i) => {
              if (!day) return <span key={i} className="period-day empty" />;
              const t = day.getTime();
              const future = t > today.getTime();
              const inRange = !!sel && t >= sel.start && t <= sel.end;
              const isEnd = !!sel && (t === sel.start || t === sel.end);
              const classes = ["period-day"];
              if (future) classes.push("disabled");
              if (t === today.getTime()) classes.push("today");
              if (inRange) classes.push("in-range");
              if (isEnd) classes.push("range-end");
              return (
                <button
                  key={i}
                  type="button"
                  className={classes.join(" ")}
                  disabled={future}
                  onClick={() => onDayClick(day)}
                  onMouseEnter={() => setHover(day)}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>

          <div className="period-footer">
            <span className="period-range-label">
              {draftStart ? formatRangeLabel({ start: draftStart, end: draftEnd ?? draftStart }) : "Selecione as datas"}
            </span>
            <button type="button" className="period-apply" disabled={!draftStart} onClick={apply}>
              Aplicar
            </button>
          </div>
        </div>
      )}
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
