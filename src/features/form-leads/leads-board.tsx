"use client";

/**
 * The caller's kanban board on /marketing — who to phone, and what happened.
 *
 * Everything here writes `board_column`/`call_*` through updateFormLeadBoard and
 * NOTHING here writes `stage` or fires a Meta CAPI event. That is what lets a drag
 * commit instantly with no confirm step, while the dropdown in the table below still
 * needs one: a move on this board is always reversible by dragging back.
 *
 * Drag and drop is native HTML5 rather than a library. The board has no in-column
 * reordering, no scrollable columns and no touch requirement, which is exactly the
 * set of things native DnD is bad at — so the ~10 kB of @dnd-kit buys nothing here.
 * Reach for it the day any of those three changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFormLeadBoard } from "./actions";
import { boardColumnFor, groupForBoard } from "./board-columns";
import { MAX_CALL_ATTEMPTS } from "./call-cadence";
import { STAGE_COLORS } from "./form-leads-table";
import {
  A_LIGAR,
  BOARD_COLUMN_KEYS,
  BOARD_COLUMN_LABELS,
  type BoardColumn,
  type BoardColumnKey,
  type FormLeadRow,
} from "./types";
import { stageLabel } from "./types";

/** Accent per column, reusing the table's stage palette where the meaning lines up. */
const COLUMN_ACCENT: Record<BoardColumnKey, string> = {
  a_ligar: "var(--muted)",
  nao_atendeu: "#bf8f6b",
  retorno: "#7aa2f7",
  qualificado: STAGE_COLORS.qualificado,
  agendado: STAGE_COLORS.agendado,
  removido: STAGE_COLORS.perdido,
};

/** Cards past this fold behind a "ver mais" so a column never needs its own scrollbar. */
const CARDS_BEFORE_FOLD = 15;

const ORDINAL = ["", "1ª", "2ª", "3ª"];

function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A once-a-minute clock, as an external store.
 *
 * The board renders on the server too, and "hoje"/"atrasada" computed from a
 * `new Date()` on both sides lands in two different places — which hydrates
 * mismatched. useSyncExternalStore is the primitive built for exactly that: the
 * server snapshot is null (no due labels in the first paint), and the client
 * swaps in the real time right after hydration.
 */
let clockNowMs = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | null = null;

function subscribeToClock(onChange: () => void): () => void {
  clockListeners.add(onChange);
  clockTimer ??= setInterval(() => {
    clockNowMs = Date.now();
    for (const listener of clockListeners) listener();
  }, 60_000);

  return () => {
    clockListeners.delete(onChange);
    if (clockListeners.size === 0 && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** Milliseconds on the client, null while rendering on the server. */
function useClock(): Date | null {
  const ms = useSyncExternalStore(
    subscribeToClock,
    () => clockNowMs,
    () => null,
  );
  return useMemo(() => (ms === null ? null : new Date(ms)), [ms]);
}

/**
 * The whole phrase, not a fragment — "ligar hoje 16:00", "atrasada · 17:00". Overdue
 * reads on its own and must not get a "ligar" prefix bolted in front of it.
 */
function dueLabel(iso: string | null, now: Date | null): { text: string; overdue: boolean } | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (Number.isNaN(due.getTime())) return null;
  const time = due.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  // Before hydration there is no clock, so the date is shown without a relative word.
  if (!now) return { text: time, overdue: false };

  const dayOf = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  const dueDay = dayOf(due);
  const today = dayOf(now);
  const short = `${dueDay.slice(8)}/${dueDay.slice(5, 7)}`;

  if (dueDay === today) {
    return due.getTime() < now.getTime()
      ? { text: `atrasada · ${time}`, overdue: true }
      : { text: `ligar hoje ${time}`, overdue: false };
  }
  if (dueDay < today) return { text: `atrasada · ${short}`, overdue: true };

  const tomorrow = dayOf(new Date(now.getTime() + 86_400_000));
  if (dueDay === tomorrow) return { text: `ligar amanhã ${time}`, overdue: false };
  return { text: `ligar ${short} ${time}`, overdue: false };
}

export function LeadsBoard({ rows }: { rows: FormLeadRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Board moves applied locally the moment they're made. The action is authoritative
   * and returns the real counters, so this is reconciled rather than guessed at.
   */
  const [pending, setPending] = useState<Record<string, Partial<FormLeadRow>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Null during the server render, real time from just after hydration. See useClock.
  const now = useClock();

  /**
   * The dragged lead lives in a ref, not state: a re-render while a native drag is in
   * flight aborts it in Chrome. Nothing on screen depends on it either.
   */
  const dragging = useRef<{ id: string; from: BoardColumnKey } | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardColumnKey | null>(null);
  /**
   * dragenter/dragleave fire for every child crossed, so a plain boolean flickers as
   * the pointer moves card → gap → card. Counting depth per column is the fix;
   * relatedTarget is not, because it is null in Safari mid-drag.
   */
  const depth = useRef<Record<string, number>>({});

  /**
   * One refresh after the dust settles, not one per drop. Server Functions are
   * dispatched one at a time, and each router.refresh() re-runs the whole Promise.all
   * in marketing/page.tsx — so a refresh per drag turns four drags into eight round
   * trips, and one landing mid-drag kills the next drag outright.
   */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => startTransition(() => router.refresh()), 1500);
  }, [router]);
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
  }, []);

  const merged = useMemo(
    () => rows.map((r) => (pending[r.id] ? { ...r, ...pending[r.id] } : r)),
    [rows, pending],
  );
  const grouped = useMemo(() => groupForBoard(merged, todayIsoUtc()), [merged]);

  const commit = useCallback(
    (row: FormLeadRow, to: BoardColumnKey, opts?: { registerAttempt?: boolean }) => {
      setError(null);

      let callbackAtIso: string | null = null;
      if (to === "retorno") {
        const typed = window.prompt(
          "Que dia você combinou de ligar de volta? (dd/mm ou dd/mm hh:mm)",
        );
        if (typed === null) return;
        const parsed = parseCallback(typed);
        if (!parsed) {
          setError("Não entendi a data. Use dd/mm, por exemplo 05/09 ou 05/09 14:30.");
          return;
        }
        callbackAtIso = parsed;
      }

      const column: BoardColumn | null = to === A_LIGAR ? null : to;
      const before = { ...row };

      setPending((p) => ({
        ...p,
        [row.id]: {
          board_column: column,
          call_attempts: opts?.registerAttempt
            ? Math.min(row.call_attempts + 1, MAX_CALL_ATTEMPTS)
            : row.call_attempts,
        },
      }));

      startTransition(async () => {
        const res = await updateFormLeadBoard(row.id, column, {
          registerAttempt: opts?.registerAttempt,
          callbackAtIso,
        });
        if ("error" in res) {
          // Put the card back where it was and say why, same as the table's revert.
          setPending((p) => ({
            ...p,
            [row.id]: {
              board_column: before.board_column,
              call_attempts: before.call_attempts,
              next_call_at: before.next_call_at,
            },
          }));
          setError(res.error);
          return;
        }
        // Settle on the server's numbers rather than the optimistic guess.
        setPending((p) => ({
          ...p,
          [row.id]: { board_column: column, call_attempts: res.attempts, next_call_at: res.nextCallAt },
        }));
        scheduleRefresh();
      });
    },
    [scheduleRefresh],
  );

  function clearDropState(column: BoardColumnKey) {
    depth.current[column] = 0;
    setDropTarget(null);
  }

  function onDrop(to: BoardColumnKey) {
    const drag = dragging.current;
    dragging.current = null;
    clearDropState(to);
    if (!drag) return;
    // Dropping a card back where it started is the universal "never mind" gesture, so
    // it must not write anything — which is also why "+1 tentativa" is a button.
    if (drag.from === to) return;
    const row = merged.find((r) => r.id === drag.id);
    if (!row) return;
    commit(row, to, { registerAttempt: to === "nao_atendeu" });
  }

  const total = merged.length;

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Quadro de ligações</h3>
          <span className="muted" style={{ fontSize: 12 }}>
            Arraste as leads entre as colunas. Isso não mexe na etapa da tabela abaixo.
          </span>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{total} leads</span>
      </div>

      {error && (
        <div style={{ fontSize: 12.5, color: "#bf6b6b", background: "rgba(191,107,107,.1)", border: "1px solid rgba(191,107,107,.3)", borderRadius: 10, padding: "8px 12px" }}>
          {error}
        </div>
      )}

      {/* All six columns have to fit the page's 1200px without a horizontal scrollbar —
          a board you have to scroll sideways to see the last column is a board whose
          last column nobody uses. minmax lets them shrink to fit and scroll only on a
          genuinely narrow window. */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${BOARD_COLUMN_KEYS.length}, minmax(150px, 1fr))`, gap: 10, overflowX: "auto", paddingBottom: 4 }}>
        {BOARD_COLUMN_KEYS.map((key) => {
          const cards = grouped.get(key) ?? [];
          const isTarget = dropTarget === key;
          const showAll = expanded[key] ?? false;
          const visible = showAll ? cards : cards.slice(0, CARDS_BEFORE_FOLD);

          return (
            <div
              key={key}
              role="group"
              aria-label={BOARD_COLUMN_LABELS[key]}
              onDragEnter={(e) => {
                e.preventDefault();
                depth.current[key] = (depth.current[key] ?? 0) + 1;
                if (depth.current[key] === 1) setDropTarget(key);
              }}
              onDragLeave={() => {
                depth.current[key] = Math.max(0, (depth.current[key] ?? 0) - 1);
                if (depth.current[key] === 0) setDropTarget((t) => (t === key ? null : t));
              }}
              // Without preventDefault here the browser never fires onDrop at all.
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(key);
              }}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                minHeight: 120,
                padding: 8,
                borderRadius: 14,
                background: isTarget ? "rgba(217,178,76,.08)" : "transparent",
                border: `1px solid ${isTarget ? "rgba(217,178,76,.45)" : "transparent"}`,
                transition: "background .15s, border-color .15s",
              }}
            >
              <div style={{ borderTop: `2px solid ${COLUMN_ACCENT[key]}`, paddingTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".3px" }}>
                  {BOARD_COLUMN_LABELS[key]}
                </span>
                <span className="muted" style={{ fontSize: 11, fontWeight: 700, background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 999, padding: "1px 7px" }}>
                  {cards.length}
                </span>
              </div>

              {visible.map((row) => (
                <BoardCard
                  key={row.id}
                  row={row}
                  now={now}
                  onDragStart={(e) => {
                    dragging.current = { id: row.id, from: boardColumnFor(row) };
                    // Firefox refuses to start a drag without payload on the transfer.
                    e.dataTransfer.setData("text/plain", row.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    dragging.current = null;
                    depth.current = {};
                    setDropTarget(null);
                  }}
                  onMove={(to) => commit(row, to, { registerAttempt: to === "nao_atendeu" })}
                  onRegisterAttempt={() => commit(row, "nao_atendeu", { registerAttempt: true })}
                />
              ))}

              {cards.length > visible.length && (
                <button
                  onClick={() => setExpanded((x) => ({ ...x, [key]: true }))}
                  className="muted"
                  style={{ fontSize: 11.5, fontWeight: 600, background: "transparent", border: "1px dashed var(--line)", borderRadius: 10, padding: "6px 8px", cursor: "pointer" }}
                >
                  ver mais ({cards.length - visible.length})
                </button>
              )}

              {cards.length === 0 && (
                <span className="muted" style={{ fontSize: 11.5, padding: "6px 2px" }}>—</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({
  row, now, onDragStart, onDragEnd, onMove, onRegisterAttempt,
}: {
  row: FormLeadRow;
  now: Date | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onMove: (to: BoardColumnKey) => void;
  onRegisterAttempt: () => void;
}) {
  const column = boardColumnFor(row);
  const answered = row.stage === "respondeu";
  const due = dueLabel(row.next_call_at, now);
  const spent = row.call_attempts >= MAX_CALL_ATTEMPTS;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Deliberately NOT the global `.card` class: its hover transform makes the
      // browser snapshot a half-animated element as the drag ghost.
      style={{
        padding: "9px 11px",
        borderRadius: 12,
        background: "var(--panel-hi)",
        border: "1px solid var(--line)",
        borderLeft: answered ? `3px solid ${STAGE_COLORS.respondeu}` : "1px solid var(--line)",
        fontSize: 12.5,
        cursor: "grab",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      {/* Columns are narrow enough to clip a long name, so the full one lives in the
          tooltip rather than nowhere. */}
      <div title={row.name ?? undefined} style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.name ?? "Sem nome"}
      </div>

      <div className="muted" style={{ fontSize: 11.5 }}>{row.phone ?? "sem telefone"}</div>

      {answered && (
        <span style={{ fontSize: 11, fontWeight: 700, color: STAGE_COLORS.respondeu }}>
          Respondeu no WhatsApp
        </span>
      )}

      {column === "nao_atendeu" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6, padding: "1px 5px" }}>
            {ORDINAL[row.call_attempts] ?? `${row.call_attempts}ª`}
          </span>
          <span
            className={due?.overdue ? undefined : "muted"}
            style={{ fontSize: 11, color: due?.overdue ? "#bf6b6b" : undefined, fontWeight: due?.overdue ? 600 : undefined }}
          >
            {spent ? "tentativas esgotadas" : (due?.text ?? "—")}
          </span>
        </div>
      )}

      {column === "retorno" && due && (
        <span
          className={due.overdue ? undefined : "muted"}
          style={{ fontSize: 11, color: due.overdue ? "#bf6b6b" : undefined, fontWeight: due.overdue ? 600 : undefined }}
        >
          {due.overdue ? due.text : `retorno ${due.text.replace(/^ligar /, "")}`}
        </span>
      )}

      {/* The real funnel, read-only. The board and the table can legitimately disagree,
          and the caller needs to see both without being able to confuse one for the
          other. Skipped when she answered, because the line above already says it and
          repeating it costs a whole row on an already narrow card. */}
      {!answered && (
        <span className="muted" style={{ fontSize: 10.5, opacity: 0.75 }}>
          etapa: {stageLabel(row.stage)}
        </span>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
        {column === "nao_atendeu" && !spent && (
          <button
            onClick={onRegisterAttempt}
            style={{ fontSize: 10.5, fontWeight: 600, background: "transparent", border: "1px solid var(--line)", borderRadius: 8, padding: "2px 6px", color: "var(--muted)", cursor: "pointer" }}
          >
            +1 tentativa
          </button>
        )}
        {/* Native DnD does not work on touch at all, so every move must also be
            reachable by click — which means this cannot be hover-only. Styled as quiet
            text rather than a form control: eleven bordered <select>s make the board
            read as a form, and the card should read name first. */}
        <select
          aria-label={`Mover ${row.name ?? row.id} para outra coluna`}
          value={column}
          onChange={(e) => onMove(e.target.value as BoardColumnKey)}
          title="Mover para outra coluna"
          style={{
            fontSize: 10.5,
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 8,
            padding: "1px 2px",
            marginLeft: "auto",
            color: "var(--muted2)",
            cursor: "pointer",
            maxWidth: 116,
          }}
        >
          {BOARD_COLUMN_KEYS.map((k) => (
            <option key={k} value={k} style={{ background: "var(--panel-hi)", color: "var(--txt)" }}>
              {BOARD_COLUMN_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * "05/09" or "05/09 14:30" typed by the caller, as an ISO instant in BRT. Kept
 * permissive on purpose — the server re-validates and snaps it into business hours,
 * so this only has to be good enough to send.
 */
export function parseCallback(input: string, now: Date = new Date()): string | null {
  const m = input.trim().match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?:\s+(\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;

  const day = Number(dd);
  const month = Number(mm);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;

  const currentYear = now.getUTCFullYear();
  let year = yy ? Number(yy) : currentYear;
  if (year < 100) year += 2000;

  const hour = hh ? Number(hh) : 9;
  const minute = mi ? Number(mi) : 0;
  if (hour > 23 || minute > 59) return null;

  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` +
    `T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  // No year given and the date already passed? She means next year.
  if (!yy && parsed.getTime() < now.getTime()) {
    const nextYear = new Date(iso.replace(String(year), String(year + 1)));
    return Number.isNaN(nextYear.getTime()) ? null : nextYear.toISOString();
  }
  return parsed.toISOString();
}
