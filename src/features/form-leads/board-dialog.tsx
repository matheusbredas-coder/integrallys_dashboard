"use client";

/**
 * The two questions the board has to ask before it writes — as a modal in the middle
 * of the screen, in the app's own material.
 *
 * Both were window.confirm/window.prompt until 2026-09-02. Those work, but they paint
 * a Chrome-coloured strip at the top of the window ("localhost:3000 says…") that has
 * nothing to do with the CRM, so they are gone and must not come back.
 *
 * One component for both variants: they share the whole shell — overlay, panel, the
 * pair of buttons — and differ only in the title, the body and the confirm label.
 *
 * Layout follows lead-notes-drawer.tsx (same overlay, same panel colours), except this
 * one is centred rather than docked right: it interrupts a drag, and an interruption
 * belongs where the eye already is.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FormLeadRow } from "./types";

export type BoardDialogRequest =
  /** Dragged back to "A ligar", and there is a call history to throw away. */
  | { kind: "restart"; row: FormLeadRow; lost: string[] }
  /** Dragged into "Retorno marcado", which cannot be written without a date. */
  | { kind: "callback"; row: FormLeadRow; registerAttempt: boolean };

/** "2026-09-02" for a date input, in São Paulo time rather than the browser's. */
function isoDayBrt(atMs: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(atMs));
}

export function BoardDialog({
  request, onCancel, onConfirm,
}: {
  request: BoardDialogRequest;
  onCancel: () => void;
  /** The callback instant for "retorno", null for a restart. */
  onConfirm: (callbackAtIso: string | null) => void;
}) {
  // Read the clock once, when the dialog opens: `Date.now()` in the render body is
  // impure, and a re-render must not slide the floor of the calendar under the caller.
  const [{ today, tomorrow }] = useState(() => ({
    today: isoDayBrt(Date.now()),
    tomorrow: isoDayBrt(Date.now() + 86_400_000),
  }));
  // Tomorrow, 09:00 — what the old dd/mm prompt defaulted to when no hour was typed.
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("09:00");

  const dateRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // The caller opens the callback dialog to type a date, so the cursor lands there.
  // The restart dialog erases things, so the focus goes on Cancelar instead — never
  // on the button that throws the history away.
  useEffect(() => {
    if (request.kind === "callback") dateRef.current?.focus();
    else cancelRef.current?.focus();
  }, [request.kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const name = request.row.name?.trim() || "essa lead";

  function confirm() {
    if (request.kind === "restart") {
      onConfirm(null);
      return;
    }
    if (!date) return;
    // -03:00 spelled out: the caller means Brazilian time, whatever the machine's zone
    // is set to. The server re-validates this and snaps it into business hours, so it
    // only has to be a real instant.
    const parsed = new Date(`${date}T${time || "09:00"}:00-03:00`);
    if (Number.isNaN(parsed.getTime())) return;
    onConfirm(parsed.toISOString());
  }

  const title = request.kind === "restart" ? "Começar do zero?" : "Retorno marcado";

  /**
   * Rendered into <body>, not where it sits in the tree — same reason as the notes
   * drawer: the board's root carries the global `.card`, whose hover transform makes
   * it the containing block for any `position: fixed` child, which would clamp this
   * to the board's box instead of centring it on the screen.
   */
  const modal = (
    <div
      onMouseDown={(e) => {
        // Only a press that both starts and ends on the backdrop closes it — otherwise
        // a text selection that drifts out of the panel would dismiss the dialog.
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed", inset: 0, zIndex: 40,
        background: "rgba(0,0,0,.55)",
        display: "grid", placeItems: "center", padding: 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: "100%", maxWidth: 420, zIndex: 41,
          background: "var(--panel-to)", border: "1px solid var(--line)",
          borderRadius: 16, padding: 24,
          display: "flex", flexDirection: "column", gap: 14,
          boxShadow: "0 24px 60px rgba(0,0,0,.45)",
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.3px", margin: 0 }}>
          {title}
        </h2>

        {request.kind === "restart" ? (
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>
            Voltar <strong style={{ color: "var(--txt)" }}>{name}</strong> para “A ligar”
            apaga {request.lost.join(" e ")}. O lead começa do zero.
          </p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.55, margin: 0 }}>
              Que dia você combinou de ligar de volta para{" "}
              <strong style={{ color: "var(--txt)" }}>{name}</strong>?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Dia</span>
                <input
                  ref={dateRef}
                  type="date"
                  value={date}
                  min={today}
                  onChange={(e) => setDate(e.target.value)}
                  style={fieldStyle}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>Hora</span>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={fieldStyle}
                />
              </label>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            ref={cancelRef}
            onClick={onCancel}
            style={{
              background: "transparent", color: "var(--muted)",
              border: "1px solid var(--line)", borderRadius: 10,
              padding: "9px 15px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={request.kind === "callback" && !date}
            style={{
              // Red for the one that erases, green for the one that just books a date —
              // the same pair the drawer's Salvar and the card's overdue text already use.
              background: request.kind === "restart" ? "#bf6b6b" : "#6bbf73",
              color: "#0b0f0d",
              border: "1px solid var(--line)", borderRadius: 10,
              padding: "9px 15px", fontSize: 12.5, fontWeight: 700,
              cursor: request.kind === "callback" && !date ? "default" : "pointer",
              opacity: request.kind === "callback" && !date ? 0.5 : 1,
            }}
          >
            {request.kind === "restart" ? "Sim, começar do zero" : "Marcar retorno"}
          </button>
        </div>
      </div>
    </div>
  );

  // The dialog only ever opens from a drop, so `document` exists by then; the guard is
  // for the server render, where nothing is open anyway.
  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}

/**
 * Same material as the drawer's textarea. `colorScheme` is what keeps the browser's
 * own date and time pickers dark — without it Chrome paints a white calendar over the
 * dark panel.
 */
const fieldStyle: React.CSSProperties = {
  background: "var(--panel-hi)",
  border: "1px solid var(--line)",
  borderRadius: 12,
  padding: "10px 12px",
  color: "var(--txt)",
  fontSize: 13,
  fontFamily: "inherit",
  colorScheme: "dark",
  width: "100%",
};
