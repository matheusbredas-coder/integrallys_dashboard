"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { refreshAgenda, setAgendaBlocks } from "./actions";
import type { OverrideKind } from "./blocks";
import { cellAt, halfHourRows, isBooked, rangeLabel } from "./grid";
import { BOOKING_RULES, MAX_WEEK_OFFSET } from "./rules";
import { minutesToHhmm } from "./slots";
import type { AgendaDay, AgendaWeek, DayOutcome } from "./types";
import { formatDayMonth, todayLocalISO } from "./time";

/**
 * The week's diary, as a grid — the caller's answer to "que horário eu ofereço?"
 * without opening Gestek, and the clinic's way of closing a time by hand.
 *
 * It reads as occupancy and nothing else: every half hour that is spoken for is
 * crossed out, every other half hour is empty, and she offers into the holes. No
 * patient name is shown — the caller does not need to know WHO is in the chair to
 * pick a time, and the page is open on a desk all day.
 *
 * Editing is MARK, then SAVE — never a write per click. A grey cross is settled
 * fact: a Gestek appointment, or a block already saved. A gold cell is a mark that
 * exists only on this screen until the Salvar button is pressed, which is what
 * makes a mis-drag across half the week a nuisance instead of an accident. The bot
 * reads what is saved, so a time crossed out here is a time it stops offering.
 *
 * It goes both ways. A grey cross can also be OPENED — handed back out despite the
 * appointment on it, for a cancellation nobody removed from Gestek. An opened half
 * hour reads as available, because that is what the clinic just made it.
 *
 * Rows are a fixed half-hour ladder across the clinic's whole day, so a column
 * can be read down like a diary page. It stretches beyond opening hours only when
 * something is genuinely booked out there — staff do book at 11:45.
 */

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** What an empty column says. A blank cell would send her to phone the clinic. */
const OUTCOME_NOTE: Record<Exclude<DayOutcome, "ok">, string> = {
  closed: "Fechado",
  past: "Já passou",
  full: "Sem encaixe",
  "too-late": "Curto demais",
  error: "Erro no Gestek",
};

/** Taken: an appointment, or a block already saved. The two read the same. */
const BUSY_BG = "color-mix(in srgb, var(--txt) 11%, transparent)";
/** Marked, not saved. Gold is this dashboard's "you did this, it is not filed yet". */
const MARKED_BG = "color-mix(in srgb, var(--gold) 14%, transparent)";

/** A day whose column is read-only: nothing said here can change the past. */
const isLocked = (day: AgendaDay) => day.outcome === "past" || day.outcome === "closed";

const cell: React.CSSProperties = {
  borderTop: "1px solid var(--line)",
  padding: 0,
  textAlign: "center",
  fontSize: 12.5,
  height: 34,
};

/** The cross itself. One glyph, centred — the whole vocabulary of the grid. */
const cross: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1,
  fontWeight: 400,
};

const navLink: React.CSSProperties = {
  border: "1px solid var(--line)",
  borderRadius: 10,
  padding: "7px 12px",
  fontSize: 12.5,
  color: "var(--muted)",
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const saveButton: React.CSSProperties = {
  ...navLink,
  border: "1px solid var(--gold)",
  color: "var(--gold-soft)",
  background: MARKED_BG,
  cursor: "pointer",
  fontFamily: "inherit",
  fontWeight: 600,
};

function weekLabel(week: AgendaWeek): string {
  const first = week.days[0]?.dateISO ?? week.weekStartISO;
  const last = week.days[week.days.length - 1]?.dateISO ?? week.weekStartISO;
  return `${formatDayMonth(first)} a ${formatDayMonth(last)}`;
}

/** The line under each date: how full the day is, or why it is blank. */
function dayNote(day: AgendaDay): string {
  if (day.bookedCount === null) return day.outcome === "ok" ? "" : OUTCOME_NOTE[day.outcome];
  if (day.bookedCount === 0) return "dia livre";
  return `${day.bookedCount} na agenda`;
}

function DayHeader({ day, isToday }: { day: AgendaDay; isToday: boolean }) {
  return (
    <th style={{ padding: "0 8px 10px", textAlign: "center", fontWeight: 700 }}>
      <span style={{ display: "block", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: isToday ? "var(--gold)" : "var(--muted)" }}>
        {WEEKDAY_LABELS[day.weekday]}
      </span>
      <span style={{ display: "block", fontSize: 14, color: isToday ? "var(--gold-soft)" : "inherit" }}>
        {formatDayMonth(day.dateISO)}
      </span>
      <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--muted2)", marginTop: 2 }}>
        {dayNote(day)}
      </span>
    </th>
  );
}

function Legend() {
  const mark = (color: string): React.CSSProperties => ({
    display: "inline-block",
    width: 14,
    textAlign: "center",
    color,
    marginRight: 5,
    fontWeight: 600,
  });
  return (
    <div className="muted" style={{ fontSize: 11.5, display: "flex", gap: 16, flexWrap: "wrap" }}>
      <span><i style={mark("var(--muted)")}>×</i>ocupado: paciente na agenda, ou bloqueio já salvo</span>
      <span><i style={mark("var(--gold-soft)")}>×</i>marcado, ainda não salvo</span>
      <span>Clique ou arraste para marcar os horários e depois clique em Salvar.</span>
    </div>
  );
}

/** "2026-09-03|780" — one half hour, as a key a Set or a Map can hold. */
const keyOf = (dateISO: string, startMin: number) => `${dateISO}|${startMin}`;

/** Every half hour the clinic has already decided about, and which way. */
function decidedFrom(week: AgendaWeek): Map<string, OverrideKind> {
  const map = new Map<string, OverrideKind>();
  for (const day of week.days) {
    for (const min of day.blockedStarts) map.set(keyOf(day.dateISO, min), "block");
    for (const min of day.openedStarts) map.set(keyOf(day.dateISO, min), "open");
  }
  return map;
}

/**
 * What a cell becomes under a drag going one way.
 *
 * A drag carries ONE intent — make these available, or make these unavailable —
 * decided by the cell it started on. What that costs each cell depends on what the
 * cell is, and the two cases are opposites: freeing a booked half hour means
 * overruling Gestek, freeing a blocked one means withdrawing what we said. Reading
 * the intent per cell instead of storing one direction is what lets a sweep across
 * a mixed row do the obvious thing.
 */
function targetFor(booked: boolean, opening: boolean): OverrideKind | null {
  if (opening) return booked ? "open" : null;
  return booked ? null : "block";
}

/** The cells one drag has already painted, so re-entering one does not flip it. */
type Drag = { opening: boolean; touched: Set<string> };

export function AvailabilityTable({ week }: { week: AgendaWeek }) {
  const today = todayLocalISO();
  const rows = halfHourRows(week.days, BOOKING_RULES);
  const prev = Math.max(-MAX_WEEK_OFFSET, week.offset - 1);
  const next = Math.min(MAX_WEEK_OFFSET, week.offset + 1);

  /**
   * What the server has on file, and what the clinic has marked on top of it.
   *
   * `decided` is re-seeded whenever the server's answer changes — the "adjust
   * state when a prop changes" pattern rather than an effect. A re-seed also drops
   * the marks: the server has just spoken, and keeping marks made against a
   * different version of the week would be marking cells nobody looked at.
   */
  const serverState = week.days
    .map((d) => `${d.dateISO}:${d.blockedStarts.join(",")}:${d.openedStarts.join(",")}`)
    .join("|");
  const [seed, setSeed] = useState(serverState);
  const [decided, setDecided] = useState(() => decidedFrom(week));
  /** key -> what the clinic wants instead. Only entries that DIFFER from `decided` live here. */
  const [marks, setMarks] = useState<Map<string, OverrideKind | null>>(new Map());
  if (seed !== serverState) {
    setSeed(serverState);
    setDecided(decidedFrom(week));
    setMarks(new Map());
  }

  const [saving, startSaving] = useTransition();
  const [failure, setFailure] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const wanted = (key: string) => (marks.has(key) ? marks.get(key)! : decided.get(key) ?? null);

  /**
   * The week as the grid draws it: the server's days with the marks laid over
   * them, so `cellAt` stays the single place that decides what a half hour is —
   * including that an appointment outranks a block, and an open outranks the
   * appointment.
   */
  const days = week.days.map((day) => ({
    ...day,
    blockedStarts: rows.filter((min) => wanted(keyOf(day.dateISO, min)) === "block"),
    openedStarts: rows.filter((min) => wanted(keyOf(day.dateISO, min)) === "open"),
  }));

  /** Mark one cell in the drag's direction. Idempotent — the pointer re-enters. */
  const paint = (dateISO: string, startMin: number, booked: boolean) => {
    const state = drag.current;
    if (!state) return;
    const key = keyOf(dateISO, startMin);
    if (state.touched.has(key)) return;
    state.touched.add(key);

    const target = targetFor(booked, state.opening);
    setMarks((current) => {
      const next = new Map(current);
      // A mark that agrees with the server is not a change: clicking a cell twice
      // leaves nothing to save, rather than a write that says what is already true.
      if ((decided.get(key) ?? null) === target) next.delete(key);
      else next.set(key, target);
      return next;
    });
  };

  const startDrag = (dateISO: string, startMin: number, booked: boolean, available: boolean) => {
    // The cell under the pointer decides the direction for the whole sweep, so a
    // drag never inverts cell by cell and leaves a stripe behind it.
    drag.current = { opening: !available, touched: new Set() };
    paint(dateISO, startMin, booked);
  };

  const endDrag = () => {
    drag.current = null;
  };

  /**
   * File the marks: one call per day and per direction.
   *
   * Marks are only cleared for what the server accepted. A refused day keeps its
   * gold cells, which is the honest state — nothing was written, and the clinic
   * can press Salvar again without redoing the drag.
   */
  const save = () => {
    if (marks.size === 0) return;

    const byDate = new Map<string, Map<OverrideKind | null, number[]>>();
    for (const [key, kind] of marks) {
      const [dateISO, min] = key.split("|");
      let group = byDate.get(dateISO!);
      if (!group) byDate.set(dateISO!, (group = new Map()));
      const mins = group.get(kind);
      if (mins) mins.push(Number(min));
      else group.set(kind, [Number(min)]);
    }

    startSaving(async () => {
      const written: string[] = [];
      let message: string | null = null;

      for (const [dateISO, group] of byDate) {
        for (const [kind, mins] of group) {
          const result = await setAgendaBlocks(dateISO, mins, kind);
          if ("error" in result) message ??= result.error;
          else for (const min of mins) written.push(keyOf(dateISO, min));
        }
      }

      setFailure(message);
      if (written.length === 0) return;

      // Settle the saved ones immediately. The page refresh that follows carries
      // the same answer, so the cells do not blink on their way to being grey.
      setDecided((current) => {
        const nextDecided = new Map(current);
        for (const key of written) {
          const kind = marks.get(key) ?? null;
          if (kind) nextDecided.set(key, kind);
          else nextDecided.delete(key);
        }
        return nextDecided;
      });
      setMarks((current) => {
        const kept = new Map(current);
        for (const key of written) kept.delete(key);
        return kept;
      });
    });
  };

  const discard = () => {
    setMarks(new Map());
    setFailure(null);
  };

  // Marks live only in this tab until they are saved, so leaving with unsaved ones
  // throws them away silently. Ask first — a week's worth of drags is real work.
  useEffect(() => {
    if (marks.size === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [marks.size]);

  /** The same question for an in-app link, which never triggers beforeunload. */
  const confirmLeave = (e: React.MouseEvent) => {
    if (marks.size === 0) return;
    if (!window.confirm("Você marcou horários e ainda não salvou. Sair e perder as marcações?")) {
      e.preventDefault();
    }
  };

  return (
    <div
      className="card"
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}
      // Ending the drag on the container, not just on a cell, so releasing the
      // button off the grid still stops the sweep instead of leaving it armed.
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Link href={`/marketing?semana=${prev}`} scroll={false} style={navLink} aria-label="Semana anterior" onClick={confirmLeave}>←</Link>
        <strong style={{ fontSize: 14 }}>
          {week.offset === 0 ? "Esta semana" : week.offset === 1 ? "Semana que vem" : `Semana de ${formatDayMonth(week.weekStartISO)}`}
        </strong>
        <span className="muted" style={{ fontSize: 12.5 }}>({weekLabel(week)})</span>
        <Link href={`/marketing?semana=${next}`} scroll={false} style={navLink} aria-label="Próxima semana" onClick={confirmLeave}>→</Link>
        {week.offset !== 0 && (
          <Link href="/marketing?semana=0" scroll={false} style={{ ...navLink, color: "var(--gold-soft)" }} onClick={confirmLeave}>Hoje</Link>
        )}
        <span style={{ flex: 1 }} />
        {failure && <span style={{ fontSize: 11.5, color: "var(--danger, #e5484d)" }}>{failure}</span>}
        <span className="muted" style={{ fontSize: 11.5 }}>
          {saving ? "Salvando…" : `Atualizado às ${week.fetchedAt}`}
        </span>

        {marks.size > 0 ? (
          <>
            <button type="button" onClick={discard} disabled={saving} style={{ ...navLink, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
              Descartar
            </button>
            <button type="button" onClick={save} disabled={saving} style={saveButton}>
              {`Salvar ${marks.size} ${marks.size === 1 ? "horário" : "horários"}`}
            </button>
          </>
        ) : (
          <form action={refreshAgenda}>
            <button type="submit" style={{ ...navLink, background: "transparent", cursor: "pointer", fontFamily: "inherit" }}>
              Atualizar
            </button>
          </form>
        )}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620, userSelect: "none" }}>
          <thead>
            <tr>
              <th style={{ padding: "0 8px 10px", textAlign: "left", fontSize: 11, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
                Horário
              </th>
              {days.map((day) => (
                <DayHeader key={day.dateISO} day={day} isToday={day.dateISO === today} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((rowStart) => {
              // The hour is the row the eye anchors on; the half is a quieter line.
              const onTheHour = rowStart % 60 === 0;
              return (
                <tr key={rowStart}>
                  <td
                    style={{
                      ...cell,
                      padding: "7px 8px",
                      textAlign: "left",
                      fontWeight: onTheHour ? 700 : 500,
                      color: onTheHour ? "inherit" : "var(--muted)",
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {minutesToHhmm(rowStart)}
                  </td>
                  {days.map((day) => {
                    const state = cellAt(day, rowStart);
                    const when = `${formatDayMonth(day.dateISO)} às ${minutesToHhmm(rowStart)}`;
                    const key = keyOf(day.dateISO, rowStart);
                    // Gold means "not filed yet", whichever way the change goes.
                    const isMarked = marks.has(key);

                    // A day that is over, or one the clinic does not work, is read-only:
                    // nothing said here could change it.
                    if (isLocked(day)) {
                      return (
                        <td key={day.dateISO} style={{ ...cell, padding: "7px 8px" }}>
                          <span style={{ color: "var(--muted2)" }}>—</span>
                        </td>
                      );
                    }

                    // Gestek's own answer, underneath everything the clinic said. An
                    // opened cell still has a patient in it, and the click on it is
                    // what puts the appointment back.
                    const booked = isBooked(day, rowStart);
                    const available = state.kind === "idle" || state.kind === "opened";

                    const label =
                      state.kind === "busy"
                        ? "ocupado na agenda"
                        : state.kind === "opened"
                          ? "liberado por vocês"
                          : state.kind === "blocked"
                            ? "bloqueado por vocês"
                            : "livre";
                    // What the mark DID, read off the state it produced.
                    const marked = available
                      ? "marcado para liberar"
                      : booked
                        ? "marcado para voltar a ficar ocupado"
                        : "marcado para bloquear";
                    const range =
                      state.kind === "busy" || state.kind === "opened"
                        ? ` · ${rangeLabel(state.startMin, state.endMin)}`
                        : "";

                    return (
                      <td
                        key={day.dateISO}
                        style={{
                          ...cell,
                          background: isMarked ? MARKED_BG : available ? undefined : BUSY_BG,
                          // A block of appointment reads as one thing, not as N
                          // stacked cells — but only where it is actually unbroken.
                          borderTop:
                            state.kind === "busy" && !state.first && !isMarked
                              ? "1px solid transparent"
                              : "1px solid var(--line)",
                        }}
                      >
                        <button
                          type="button"
                          aria-pressed={!available}
                          aria-label={`${when} — ${label}${isMarked ? `, ${marked}` : ""}`}
                          title={`${when} — ${isMarked ? `${marked}, clique em Salvar` : label}${range}`}
                          onPointerDown={(e) => {
                            e.preventDefault();
                            // A touch pointer is implicitly captured by the element
                            // it started on, which would send every later event back
                            // here and leave a finger-drag painting one cell. Let it
                            // go, so the cells the finger crosses hear about it.
                            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                              e.currentTarget.releasePointerCapture(e.pointerId);
                            }
                            startDrag(day.dateISO, rowStart, booked, available);
                          }}
                          onPointerEnter={() => paint(day.dateISO, rowStart, booked)}
                          // The keyboard has no pointer to drag, so a key press is
                          // the whole gesture: one cell, marked and released at once.
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            startDrag(day.dateISO, rowStart, booked, available);
                            endDrag();
                          }}
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "block",
                            padding: "7px 8px",
                            border: "none",
                            background: "transparent",
                            font: "inherit",
                            color: isMarked ? "var(--gold-soft)" : available ? "var(--muted2)" : "var(--muted)",
                            cursor: "pointer",
                            // A finger dragging down the column must paint it, not
                            // scroll the page out from under itself.
                            touchAction: "none",
                          }}
                        >
                          <span style={available ? undefined : { ...cross, fontWeight: isMarked ? 600 : 400 }}>
                            {available ? "—" : "×"}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {week.days.length === 0 && (
              <tr>
                <td colSpan={rows.length > 0 ? 2 : 1} style={{ ...cell, padding: "7px 8px", textAlign: "left", color: "var(--muted)" }}>
                  Nenhum dia útil nesta semana.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Legend />
    </div>
  );
}
