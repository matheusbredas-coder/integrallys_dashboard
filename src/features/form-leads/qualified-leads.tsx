"use client";

/**
 * "Leads qualificados", the list under the caller's board on /marketing.
 *
 * Every lead in the board's "Qualificado" column — including the ones that already
 * dropped off the board after TERMINAL_VISIBLE_DAYS — optionally narrowed to the day
 * she filled the form. Read-only on purpose: moving a lead out of "Qualificado" is
 * still done on the board, so this list has nothing to drag and writes nothing but
 * the notes, through the same drawer and action the board uses.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formDateFor, qualifiedLeads } from "./board-columns";
import { CARDS_BEFORE_FOLD, COLUMN_ACCENT, COLUMN_ICON, Icon } from "./leads-board";
import { LeadNotesDrawer } from "./lead-notes-drawer";
import { formatPhoneBr, telHrefBr } from "@/lib/format";
import type { FormLeadRow } from "./types";

/** "2026-09-15" → "15/09/2026". */
function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

export function QualifiedLeads({ rows }: { rows: FormLeadRow[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  /** The form day being shown, "YYYY-MM-DD"; null is "Todos". */
  const [day, setDay] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [notesLeadId, setNotesLeadId] = useState<string | null>(null);
  /** Notes saved here, shown until the refresh brings the server's copy back. */
  const [savedNotes, setSavedNotes] = useState<Record<string, string | null>>({});

  const merged = useMemo(
    () => rows.map((r) => (r.id in savedNotes ? { ...r, notes: savedNotes[r.id] } : r)),
    [rows, savedNotes],
  );
  const leads = useMemo(() => qualifiedLeads(merged, day), [merged, day]);
  const visible = showAll ? leads : leads.slice(0, CARDS_BEFORE_FOLD);
  const notesLead = notesLeadId ? merged.find((r) => r.id === notesLeadId) ?? null : null;

  return (
    <div
      className="card qualified"
      style={{ "--accent": COLUMN_ACCENT.qualificado } as React.CSSProperties}
    >
      <div className="qualified-bar">
        <span className="muted" style={{ fontSize: 12.5 }}>
          Todas as leads em &ldquo;Qualificado&rdquo; no quadro, mesmo as que já saíram dele. A data
          é a do formulário.
        </span>
        <div className="qualified-filter">
          <button
            className="board-chip"
            data-active={day === null ? "true" : "false"}
            onClick={() => { setDay(null); setShowAll(false); }}
          >
            Todos
          </button>
          <input
            type="date"
            aria-label="Dia do formulário"
            className="qualified-date"
            value={day ?? ""}
            onChange={(e) => { setDay(e.target.value || null); setShowAll(false); }}
          />
          <span className="board-col-count" data-empty={leads.length === 0 ? "true" : "false"}>
            {leads.length} {leads.length === 1 ? "lead" : "leads"}
          </span>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="board-empty" style={{ minHeight: 110 }}>
          <Icon size={20}>{COLUMN_ICON.qualificado}</Icon>
          <span style={{ fontSize: 12 }}>
            {day ? `Nenhuma lead qualificada com formulário em ${formatDay(day)}` : "Nenhuma lead qualificada ainda"}
          </span>
        </div>
      ) : (
        <div className="qualified-grid">
          {visible.map((row) => (
            <QualifiedCard key={row.id} row={row} onOpenNotes={() => setNotesLeadId(row.id)} />
          ))}
        </div>
      )}

      {leads.length > visible.length && (
        <button className="board-more" onClick={() => setShowAll(true)}>
          ver mais ({leads.length - visible.length})
        </button>
      )}

      {notesLead && (
        <LeadNotesDrawer
          row={notesLead}
          onClose={() => setNotesLeadId(null)}
          onSaved={(notes) => {
            setSavedNotes((n) => ({ ...n, [notesLead.id]: notes || null }));
            startTransition(() => router.refresh());
          }}
        />
      )}
    </div>
  );
}

function QualifiedCard({ row, onOpenNotes }: { row: FormLeadRow; onOpenNotes: () => void }) {
  const hasNotes = (row.notes ?? "").trim() !== "";
  const tel = telHrefBr(row.phone);
  const formDay = formDateFor(row);

  return (
    <div className="board-card" data-static="true">
      <div
        title={row.name ?? undefined}
        style={{ fontSize: 13.5, fontWeight: 600, letterSpacing: "-.1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {row.name ?? "Sem nome"}
      </div>
      <div className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {formatPhoneBr(row.phone)}
      </div>
      {formDay && (
        <span className="muted" style={{ fontSize: 11 }}>formulário em {formatDay(formDay)}</span>
      )}

      <div className="board-card-actions">
        <div className="board-card-actions-pair">
          {tel && (
            <a className="board-chip" href={tel} title={`Ligar para ${formatPhoneBr(row.phone)}`} style={{ textDecoration: "none" }}>
              <Icon size={12}>
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.09 4.18 2 2 0 0 1 4.08 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
              </Icon>
              <span className="chip-label">Ligar</span>
            </a>
          )}
          <button
            className="board-chip"
            data-on={hasNotes ? "true" : "false"}
            onClick={onOpenNotes}
            title={hasNotes ? "Ver e editar as observações" : "Escrever uma observação"}
          >
            <Icon size={12}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </Icon>
            <span className="chip-label">Notas{hasNotes ? " •" : ""}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
