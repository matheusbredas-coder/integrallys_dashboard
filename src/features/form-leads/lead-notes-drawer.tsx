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
import { buildBrWaMeUrl } from "@/features/wa-links/link";
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
  // Null for a row with no usable number — then the button is left out rather than
  // shown dead, since a wa.me link with junk digits opens WhatsApp on an error.
  const waUrl = buildBrWaMeUrl(row.phone);

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

        {/* The caller works the phone, but half the leads answer faster on WhatsApp —
            this opens that lead's chat so nobody has to retype the number. */}
        {waUrl && (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 12,
              padding: "11px 14px", color: "var(--txt)", fontSize: 13, fontWeight: 700,
              textDecoration: "none", flexShrink: 0,
            }}
          >
            <WhatsAppGlyph />
            Abrir conversa no WhatsApp
          </a>
        )}

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

function WhatsAppGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="#6bbf73" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.13h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.36c0-4.54 3.7-8.24 8.25-8.24a8.2 8.2 0 0 1 8.24 8.25c0 4.54-3.7 8.21-8.24 8.21Zm4.52-6.15c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.53.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.09-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.42l-.47-.01c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.12.17 1.73 2.65 4.2 3.72.59.25 1.05.4 1.4.51.59.19 1.13.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
    </svg>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right", maxWidth: 260, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
