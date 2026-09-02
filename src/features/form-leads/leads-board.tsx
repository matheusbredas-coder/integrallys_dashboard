"use client";

/**
 * The caller's kanban board on /marketing — who to phone, and what happened.
 *
 * Everything here writes `board_column`/`call_*` through updateFormLeadBoard and
 * NOTHING here writes `stage` or fires a Meta CAPI event. That is what lets a drag
 * commit instantly with no confirm step, while the dropdown in the table below still
 * needs one: a move on this board is always reversible by dragging back.
 *
 * Two drops are the exception and do stop to ask — "A ligar" (it erases a history) and
 * "Retorno marcado" (it cannot be written without a date). Both ask through the app's
 * own centred modal, board-dialog.tsx, never through window.confirm/window.prompt.
 *
 * Drag and drop is native HTML5 rather than a library, and — by explicit request —
 * it is the ONLY way to move a card. There is no click fallback.
 *
 * That has a consequence worth knowing before changing anything here: native HTML5
 * drag does not fire on touch devices at all, so the board is desktop-only. On a
 * phone or tablet a card cannot be moved by any means. If the board ever has to work
 * on a tablet, that is the day to bring in @dnd-kit (its pointer sensor handles
 * touch); the same goes for in-column reordering or columns with their own scrollbar,
 * the other two things native DnD cannot do.
 *
 * It also means jsdom cannot exercise the real thing — jsdom implements no drag, and
 * user-event does not either — so leads-board.test.tsx drives the handlers with
 * synthetic drag events and a hand-built dataTransfer. Real dragging is verified in a
 * browser, not by the suite.
 *
 * The look lives in globals.css under "Quadro de ligações", not in inline styles: the
 * column, the card and the chips all need :hover and :focus-visible states, and an
 * inline style cannot express either. Each column hands its colour down the tree as
 * the `--accent` custom property, so one rule covers all six.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateFormLeadBoard } from "./actions";
import { boardColumnFor, groupForBoard } from "./board-columns";
import { MAX_CALL_ATTEMPTS } from "./call-cadence";
import { formatPhoneBr } from "@/lib/format";
import { STAGE_COLORS } from "./form-leads-table";
import {
  A_LIGAR,
  BOARD_COLUMN_KEYS,
  BOARD_COLUMN_LABELS,
  type BoardColumn,
  type BoardColumnKey,
  type FormLeadRow,
} from "./types";
import { LeadNotesDrawer } from "./lead-notes-drawer";
import { BoardDialog, type BoardDialogRequest } from "./board-dialog";

/**
 * Accent per column. Every one is a literal colour rather than a CSS variable, because
 * the column and the cards mix it into their own background and border, and color-mix
 * needs a real colour to work with.
 *
 * Chosen by hand (Matheus, 2026-09-02) and NOT the table's stage palette any more:
 * "A ligar" is the gold of the pending work and "Não atendeu" the orange next to it —
 * the same hue as the #ff5503 he picked, taken down to the saturation and lightness the
 * other five sit at, so no column shouts over the rest. The blue/purple pair reads
 * calmest on the two columns that mean the call went well, and only "Removido" still
 * borrows from STAGE_COLORS.
 */
const COLUMN_ACCENT: Record<BoardColumnKey, string> = {
  a_ligar: "#e0af68",
  nao_atendeu: "#e2875a",
  retorno: "#b48ead",
  qualificado: "#7aa2f7",
  agendado: "#6bbf73",
  removido: STAGE_COLORS.perdido,
};

/**
 * One icon per column, so a column is recognizable before its label is read — the
 * caller works this board all day and stops reading the headers by the second week.
 *
 * Drawn inline, in the Lucide idiom (24 viewBox, 1.8 stroke, round caps), because the
 * app carries no icon package and an emoji is not an icon.
 */
const COLUMN_ICON: Record<BoardColumnKey, React.ReactNode> = {
  a_ligar: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
  ),
  nao_atendeu: (
    <>
      <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67" />
      <path d="M8.01 9.97a19.79 19.79 0 0 1-1.89-5.77A2 2 0 0 1 8.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </>
  ),
  retorno: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </>
  ),
  qualificado: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  agendado: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  ),
  removido: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </>
  ),
};

/** aria-hidden throughout: every icon here sits next to the word it illustrates. */
function Icon({ size = 15, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

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

/**
 * What a move back to "A ligar" would throw away, named for the caller — an empty list
 * when there is nothing to lose.
 *
 * Every other move on this board is reversible by dragging the card back; this one is
 * not, because the action wipes the attempts, the call dates and the note. A lead who
 * has neither has nothing to lose, so an empty list here means she moves with no
 * interruption at all.
 */
function lostOnRestart(row: FormLeadRow): string[] {
  const lost: string[] = [];
  if (row.call_attempts > 0) {
    lost.push(row.call_attempts === 1 ? "1 tentativa" : `${row.call_attempts} tentativas`);
  }
  if ((row.notes ?? "").trim() !== "") lost.push("a observação");
  return lost;
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
  /** Which lead's notes drawer is open, by id — not the row, so it survives a refresh. */
  const [notesLeadId, setNotesLeadId] = useState<string | null>(null);
  /**
   * The question a drop is waiting on, if any. Holds the row it was asked about: the
   * board can refresh underneath an open dialog, and the answer has to land on the
   * lead the caller was actually looking at.
   */
  const [dialog, setDialog] = useState<BoardDialogRequest | null>(null);

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
  // Resolved from the merged rows, so the drawer shows the note that was just saved
  // rather than the stale server copy.
  const notesLead = notesLeadId ? merged.find((r) => r.id === notesLeadId) ?? null : null;

  /**
   * The write itself — no questions asked. Everything that has to be confirmed is
   * settled by `commit` (or by the dialog) before this runs.
   */
  const performCommit = useCallback(
    (
      row: FormLeadRow,
      to: BoardColumnKey,
      opts?: { registerAttempt?: boolean; callbackAtIso?: string | null },
    ) => {
      setError(null);
      const callbackAtIso = opts?.callbackAtIso ?? null;

      const column: BoardColumn | null = to === A_LIGAR ? null : to;
      // Back to "A ligar" starts the lead over: the action wipes the attempts, the call
      // dates and the observations. `commit` is what warns about that.
      const restarting = column === null;
      const before = { ...row };

      setPending((p) => ({
        ...p,
        [row.id]: restarting
          ? {
              board_column: null,
              call_attempts: 0,
              last_call_at: null,
              next_call_at: null,
              notes: null,
            }
          : {
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
              last_call_at: before.last_call_at,
              next_call_at: before.next_call_at,
              notes: before.notes,
            },
          }));
          setError(res.error);
          return;
        }
        // Settle on the server's numbers rather than the optimistic guess. This replaces
        // the whole entry, so a restart has to re-state what it cleared.
        setPending((p) => ({
          ...p,
          [row.id]: {
            board_column: column,
            call_attempts: res.attempts,
            next_call_at: res.nextCallAt,
            ...(restarting ? { last_call_at: null, notes: null } : {}),
          },
        }));
        scheduleRefresh();
      });
    },
    [scheduleRefresh],
  );

  /**
   * The gate in front of every move. Two columns need an answer before anything is
   * written, and both get it from the centred dialog rather than a browser box —
   * nothing is made optimistic until the caller has answered, so cancelling really
   * does leave the card exactly where it was.
   */
  const commit = useCallback(
    (row: FormLeadRow, to: BoardColumnKey, opts?: { registerAttempt?: boolean }) => {
      setError(null);

      if (to === "retorno") {
        setDialog({ kind: "callback", row, registerAttempt: opts?.registerAttempt ?? false });
        return;
      }
      if (to === A_LIGAR) {
        const lost = lostOnRestart(row);
        if (lost.length > 0) {
          setDialog({ kind: "restart", row, lost });
          return;
        }
      }
      performCommit(row, to, opts);
    },
    [performCommit],
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
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h3 style={{ fontSize: 19, fontWeight: 700, margin: 0, letterSpacing: "-.2px" }}>Quadro de ligações</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Arraste as leads entre as colunas. Isso não mexe na etapa da tabela abaixo.
          </span>
        </div>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: "var(--muted)",
            background: "var(--panel-hi)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "8px 14px",
          }}
        >
          {total} leads
        </span>
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
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${BOARD_COLUMN_KEYS.length}, minmax(158px, 1fr))`, gap: 12, overflowX: "auto", paddingBottom: 4, alignItems: "stretch" }}>
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
              className="board-col"
              data-target={isTarget ? "true" : "false"}
              // The colour every child mixes into its own border, tint and icon.
              style={{ "--accent": COLUMN_ACCENT[key] } as React.CSSProperties}
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
              // dataTransfer is optional-chained because it is absent on a synthetic
              // dragover (jsdom, and anything dispatching a plain Event), and a throw
              // inside this listener would take the whole drag down.
              onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                onDrop(key);
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="board-col-icon">
                  <Icon>{COLUMN_ICON[key]}</Icon>
                </span>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", lineHeight: 1.2 }}>
                  {BOARD_COLUMN_LABELS[key]}
                </span>
                <span className="board-col-count" data-empty={cards.length === 0 ? "true" : "false"}>
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
                  onRegisterAttempt={() => commit(row, "nao_atendeu", { registerAttempt: true })}
                  onOpenNotes={() => setNotesLeadId(row.id)}
                />
              ))}

              {cards.length > visible.length && (
                <button className="board-more" onClick={() => setExpanded((x) => ({ ...x, [key]: true }))}>
                  ver mais ({cards.length - visible.length})
                </button>
              )}

              {cards.length === 0 && (
                <div className="board-empty">
                  <Icon size={20}>{COLUMN_ICON[key]}</Icon>
                  <span style={{ fontSize: 11.5, lineHeight: 1.45, maxWidth: 96 }}>Nenhuma lead nesta etapa</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dialog && (
        <BoardDialog
          request={dialog}
          onCancel={() => setDialog(null)}
          onConfirm={(callbackAtIso) => {
            setDialog(null);
            if (dialog.kind === "restart") {
              performCommit(dialog.row, A_LIGAR);
            } else {
              performCommit(dialog.row, "retorno", {
                registerAttempt: dialog.registerAttempt,
                callbackAtIso,
              });
            }
          }}
        />
      )}

      {notesLead && (
        <LeadNotesDrawer
          row={notesLead}
          onClose={() => setNotesLeadId(null)}
          onSaved={(notes) => {
            // Keep the note on screen until the debounced refresh brings the server's
            // copy back, the same way a board move is settled optimistically.
            setPending((p) => ({ ...p, [notesLead.id]: { ...p[notesLead.id], notes: notes || null } }));
            scheduleRefresh();
          }}
        />
      )}
    </div>
  );
}

function BoardCard({
  row, now, onDragStart, onDragEnd, onRegisterAttempt, onOpenNotes,
}: {
  row: FormLeadRow;
  now: Date | null;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onRegisterAttempt: () => void;
  onOpenNotes: () => void;
}) {
  const column = boardColumnFor(row);
  const due = dueLabel(row.next_call_at, now);
  const spent = row.call_attempts >= MAX_CALL_ATTEMPTS;
  const hasNotes = (row.notes ?? "").trim() !== "";

  return (
    <div className="board-card" draggable onDragStart={onDragStart} onDragEnd={onDragEnd}>
      {/* Columns are narrow enough to clip a long name, so the full one lives in the
          tooltip rather than nowhere. */}
      <div
        title={row.name ?? undefined}
        style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {row.name ?? "Sem nome"}
      </div>

      <div className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {formatPhoneBr(row.phone)}
      </div>

      {column === "nao_atendeu" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              color: "var(--accent)",
              background: "color-mix(in srgb, var(--accent) 15%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 32%, transparent)",
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
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

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
        {/* draggable={false} so grabbing the button doesn't start a card drag; the
            stopPropagation keeps the click from reaching the card underneath. */}
        <button
          className="board-chip"
          data-on={hasNotes ? "true" : "false"}
          draggable={false}
          onClick={(e) => { e.stopPropagation(); onOpenNotes(); }}
          title={hasNotes ? "Ver e editar as observações" : "Escrever uma observação"}
        >
          <Icon size={12}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </Icon>
          Notas{hasNotes ? " •" : ""}
        </button>

        {column === "nao_atendeu" && !spent && (
          <button
            className="board-chip"
            draggable={false}
            onClick={(e) => { e.stopPropagation(); onRegisterAttempt(); }}
          >
            +1 tentativa
          </button>
        )}
      </div>
    </div>
  );
}

