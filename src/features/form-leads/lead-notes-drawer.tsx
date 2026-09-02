"use client";

/**
 * The lead's own card, opened from "Notas" on the board: who she is, when she arrived,
 * and a free-text field the caller writes in after a call.
 *
 * Layout follows features/patients/patient-drawer.tsx — overlay plus a fixed panel on
 * the right — so the two drawers in the app behave the same way.
 *
 * It also carries the funnel stage as read-only text. That line used to sit on the card
 * itself and was moved here: the board and the table can legitimately disagree (the
 * board's "Agendado" is the caller's note, `stage='agendado'` is a booking that landed in
 * Gestek), and dropping the stage entirely would have taken away the only place the
 * caller could see both. Nothing here writes it.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { formatDateTimeBrt, formatPhoneBr } from "@/lib/format";
import { updateFormLeadNotes } from "./actions";
import { stageLabel, type FormLeadRow } from "./types";

export function LeadNotesDrawer({
  row, onClose, onSaved,
}: {
  row: FormLeadRow;
  onClose: () => void;
  onSaved: (notes: string) => void;
}) {
  const [draft, setDraft] = useState(row.notes ?? "");
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = draft.trim() !== (row.notes ?? "").trim();

  // Escape closes, and the cursor lands in the field — the caller opens this to type,
  // not to read.
  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateFormLeadNotes(row.id, draft);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      onSaved(res.notes);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  /**
   * Rendered into <body>, not where it sits in the tree.
   *
   * The board's root carries the global `.card` class, which has a `transform` on
   * hover — and any ancestor with a transform becomes the containing block for
   * `position: fixed` descendants. Without this portal the drawer is clamped to the
   * board's box instead of the viewport: it renders half-height, with the save button
   * cut off at the bottom edge of the card.
   */
  const drawer = (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 40 }}
      />
      <aside
        role="dialog"
        aria-label={`Notas de ${row.name ?? "lead"}`}
        // Fixed height with the notes section taking the slack, rather than a scrolling
        // box: it keeps Salvar at the bottom on any screen without a sticky footer that
        // would paint over the textarea.
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 440, maxWidth: "92vw",
          background: "var(--panel-to)", borderLeft: "1px solid var(--line)", zIndex: 41,
          padding: 26, display: "flex", flexDirection: "column", gap: 18, overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.4px", margin: 0 }}>
            {row.name ?? "Sem nome"}
          </h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", color: "var(--muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: "grid", gap: 2 }}>
          <Field label="Telefone" value={formatPhoneBr(row.phone)} />
          <Field label="E-mail" value={row.email ?? "—"} />
          <Field label="Entrou na lista" value={formatDateTimeBrt(row.created_at)} />
          <Field label="Etapa no funil" value={stageLabel(row.stage)} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
          <label htmlFor="lead-notes" style={{ fontSize: 13, fontWeight: 700 }}>
            Observações
          </label>
          <textarea
            id="lead-notes"
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="O que ela falou, o que travou, quando ligar de novo…"
            rows={8}
            style={{
              width: "100%", resize: "none", flex: 1, minHeight: 120,
              background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 12,
              padding: "12px 14px", color: "var(--txt)", fontSize: 13, lineHeight: 1.5,
              fontFamily: "inherit",
            }}
          />

          {error && (
            <span style={{ fontSize: 12.5, color: "#bf6b6b" }}>{error}</span>
          )}

          {/* Last in the column, so it sits at the bottom of the drawer on any screen
              height — a save button you have to scroll to find is one people miss. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{
                background: dirty ? "#6bbf73" : "var(--panel-hi)",
                color: dirty ? "#0b0f0d" : "var(--muted)",
                border: "1px solid var(--line)", borderRadius: 10,
                padding: "8px 14px", fontSize: 12.5, fontWeight: 700,
                cursor: saving || !dirty ? "default" : "pointer",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            {saved && !dirty && (
              <span className="muted" style={{ fontSize: 12 }}>Salvo.</span>
            )}
          </div>
        </div>
      </aside>
    </>
  );

  // The drawer only ever opens from a click, so `document` always exists by then;
  // the guard is for the server render, where nothing is open anyway.
  return typeof document === "undefined" ? null : createPortal(drawer, document.body);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", maxWidth: 260, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
