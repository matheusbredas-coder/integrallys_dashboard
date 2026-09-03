"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTimeBrt } from "@/lib/format";
import { commitFormLeadsCsv, deleteFormLead, previewFormLeadsCsv, updateFormLeadStage } from "./actions";
import { FORM_LEAD_STAGES, STAGE_LABELS, type FormLeadRow, type FormLeadStage } from "./types";

const PAGE = 25;

// Only stages the user actually moves leads to get a colour; `novo` stays neutral so the
// coloured ones read as "someone has touched this".
export const STAGE_COLORS: Record<FormLeadStage, string> = {
  novo: "var(--muted)",
  contatado: "#7aa2f7",
  // Deliberately warmer than `contatado`: the two are one step apart in the funnel but a
  // world apart in meaning — `contatado` is what we did, `respondeu` is what the lead did.
  respondeu: "#56c5c0",
  qualificado: "#b48ead",
  agendado: "#e0af68",
  ganho: "#6bbf73",
  perdido: "#bf6b6b",
};

export function FormLeadsTable({ rows }: { rows: FormLeadRow[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  // null = the order the server sent (newest first). Clicking "Nome" cycles A-Z, Z-A, and
  // back to null, so the third click is how you get the date order back.
  const [nameSort, setNameSort] = useState<"asc" | "desc" | null>(null);
  // Stage edits applied locally the moment they're made, so the <select> doesn't snap back
  // to the server value while the action and the router refresh are in flight.
  const [pendingStages, setPendingStages] = useState<Record<string, FormLeadStage>>({});
  const [error, setError] = useState<string | null>(null);

  const stageOf = (r: FormLeadRow): FormLeadStage => pendingStages[r.id] ?? r.stage;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    // Campaign and form name are no longer columns, but stay searchable — they're still on
    // the row and someone who knows the campaign can still find its leads.
    return rows.filter((r) =>
      [r.name, r.phone, r.email, r.protocolo, r.campaign, r.form_name].some((v) =>
        String(v ?? "").toLowerCase().includes(needle)
      )
    );
  }, [rows, q]);

  const sorted = useMemo(() => {
    if (!nameSort) return filtered;
    const dir = nameSort === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const an = (a.name ?? "").trim();
      const bn = (b.name ?? "").trim();
      // Leads with no name sink to the bottom in both directions — they're never what
      // someone is looking for when they sort alphabetically.
      if (!an || !bn) return an ? -1 : bn ? 1 : 0;
      return dir * an.localeCompare(bn, "pt-BR", { sensitivity: "base" });
    });
  }, [filtered, nameSort]);

  const counts = useMemo(() => {
    const acc = {} as Record<string, number>;
    for (const r of rows) {
      const s = pendingStages[r.id] ?? r.stage;
      acc[s] = (acc[s] ?? 0) + 1;
    }
    return acc;
  }, [rows, pendingStages]);

  const pageRows = sorted.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <StageCounts counts={counts} total={rows.length} />

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Pesquisar por nome, telefone, e-mail…"
            style={{ flex: 1, maxWidth: 340, padding: "10px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13 }}
          />
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} leads</span>
          <CsvImportButton onError={setError} />
        </div>

        {error && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", color: "#bf6b6b", fontSize: 12.5 }}>
            {error}
          </div>
        )}

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th
                  style={{ ...th, padding: 0 }}
                  aria-sort={nameSort === "asc" ? "ascending" : nameSort === "desc" ? "descending" : "none"}
                >
                  <button
                    onClick={() => {
                      setNameSort((s) => (s === null ? "asc" : s === "asc" ? "desc" : null));
                      setPage(0);
                    }}
                    title="Ordenar por nome: A-Z, Z-A, depois volta para a data"
                    style={sortBtn}
                  >
                    Nome
                    <span style={{ fontSize: 9, opacity: nameSort ? 1 : 0.5 }}>
                      {nameSort === "asc" ? "\u25b2" : nameSort === "desc" ? "\u25bc" : "\u2195"}
                    </span>
                  </button>
                </th>
                {["E-mail", "Telefone", "Criado em", "Protocolo", "Adicionado em", "Etapa"].map((label) => (
                  <th key={label} style={th}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ ...td, color: "#fff", fontWeight: 600 }}>{r.name ?? "—"}</td>
                  <td style={td}>{r.email ?? "—"}</td>
                  <td style={td}>
                    {r.phone ? (
                      <a href={`https://wa.me/${r.phone}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                        {r.phone}
                      </a>
                    ) : "—"}
                  </td>
                  {/* When the lead filled the form, vs. when we ingested it — the gap between
                      them is how far behind the Gmail workflow is running. */}
                  <td style={td}>{formatDateTimeBrt(r.submitted_at)}</td>
                  <td style={{ ...td, textTransform: "capitalize" }}>{r.protocolo || "—"}</td>
                  <td style={td}>{formatDateTimeBrt(r.created_at)}</td>
                  <td style={{ ...td, overflow: "visible" }}>
                    {/* Select and delete sit side by side; both grow downwards when they open
                        their confirm step, so the row keeps its top alignment. */}
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <StageSelect
                        leadId={r.id}
                        value={stageOf(r)}
                        onOptimistic={(stage) => setPendingStages((p) => ({ ...p, [r.id]: stage }))}
                        onRevert={() => setPendingStages((p) => { const next = { ...p }; delete next[r.id]; return next; })}
                        onError={setError}
                      />
                      <DeleteLeadButton leadId={r.id} onError={setError} />
                    </div>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted" style={{ ...td, padding: "26px 14px", textAlign: "center" }}>
                    {rows.length === 0 ? "Nenhum lead do formulário ainda." : "Nenhum lead corresponde à busca."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} style={pgBtn}>← Anterior</button>
          <span className="muted" style={{ fontSize: 12 }}>Página {page + 1} de {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} style={pgBtn}>Próximo →</button>
        </div>
      </div>
    </div>
  );
}

function StageSelect({
  leadId, value, onOptimistic, onRevert, onError,
}: {
  leadId: string;
  value: FormLeadStage;
  onOptimistic: (stage: FormLeadStage) => void;
  onRevert: () => void;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The select shows this while it differs from `value`; nothing is sent to the server (and
  // no Meta event fires) until the user confirms with Salvar. Picking a stage is easy to do
  // by accident on a table with one <select> per row, and a CAPI event, once sent, can't be
  // un-sent — so the commit needs an explicit second step, not just a dropdown change.
  const [draft, setDraft] = useState<FormLeadStage | null>(null);

  function commit(next: FormLeadStage) {
    onError(null);
    onOptimistic(next);
    setDraft(null);
    startTransition(async () => {
      const res = await updateFormLeadStage(leadId, next);
      if ("error" in res) {
        onRevert(); // put the dropdown back to the server's value
        onError(res.error);
        return;
      }
      router.refresh(); // re-fetch the server component so the row reflects the new stage
    });
  }

  const shownValue = draft ?? value;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <select
        value={shownValue}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as FormLeadStage;
          setDraft(next === value ? null : next);
        }}
        style={{
          background: "var(--panel-hi)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          padding: "6px 10px",
          fontSize: 12.5,
          fontWeight: 600,
          color: STAGE_COLORS[shownValue] ?? "var(--txt)",
          cursor: pending ? "wait" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {FORM_LEAD_STAGES.map((s) => (
          <option key={s} value={s} style={{ color: "var(--txt)", background: "var(--panel-hi)" }}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>

      {draft && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, whiteSpace: "normal" }}>
          <span style={{ fontSize: 11, color: "#bf6b6b" }}>Uma vez mudado, não tem volta.</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => commit(draft)}
              disabled={pending}
              style={{ ...confirmBtn, background: "#6bbf73", color: "#0b0f0d" }}
            >
              Salvar
            </button>
            <button
              onClick={() => setDraft(null)}
              disabled={pending}
              style={{ ...confirmBtn, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteLeadButton({ leadId, onError }: { leadId: string; onError: (msg: string | null) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Same two-step confirm as the stage change: a delete can't be un-sent, so it needs an
  // explicit second click rather than firing on the first one.
  const [confirming, setConfirming] = useState(false);
  const [hover, setHover] = useState(false);

  function remove() {
    onError(null);
    startTransition(async () => {
      const res = await deleteFormLead(leadId);
      if ("error" in res) {
        setConfirming(false);
        onError(res.error);
        return;
      }
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        title="Remover lead"
        aria-label="Remover lead"
        style={{
          ...confirmBtn,
          background: "transparent",
          border: "1px solid var(--line)",
          borderRadius: 10,
          // Matches the <select> next to it, so the two line up as one control pair.
          height: 30,
          width: 30,
          padding: 0,
          fontSize: 15,
          lineHeight: 1,
          color: hover ? "#bf6b6b" : "var(--muted)",
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        ×
      </button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, whiteSpace: "normal" }}>
      <span style={{ fontSize: 11, color: "#bf6b6b" }}>Remover este lead? Não tem volta.</span>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={remove}
          disabled={pending}
          style={{ ...confirmBtn, background: "#bf6b6b", color: "#0b0f0d" }}
        >
          Remover
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          style={{ ...confirmBtn, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

const confirmBtn: React.CSSProperties = {
  border: "none",
  borderRadius: 8,
  padding: "4px 10px",
  fontSize: 11.5,
  fontWeight: 600,
  cursor: "pointer",
};

type CsvSummary = { total: number; new: number; duplicate: number; invalid: number };

function CsvImportButton({ onError }: { onError: (msg: string | null) => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  // Holds the file's text once read, so Confirmar can re-send it to commitFormLeadsCsv
  // without asking the user to pick the file again.
  const [csvText, setCsvText] = useState<string | null>(null);
  const [summary, setSummary] = useState<CsvSummary | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // clears the input so picking the same file again still fires onChange
    if (!file) return;

    onError(null);
    setResult(null);
    setSummary(null);

    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      setCsvText(text);
      startTransition(async () => {
        const res = await previewFormLeadsCsv(text);
        if ("error" in res) {
          onError(res.error);
          setCsvText(null);
          return;
        }
        setSummary(res.summary);
      });
    };
    reader.readAsText(file);
  }

  function cancel() {
    setCsvText(null);
    setSummary(null);
  }

  function confirm() {
    if (!csvText) return;
    startTransition(async () => {
      const res = await commitFormLeadsCsv(csvText);
      if ("error" in res) {
        onError(res.error);
        return;
      }
      setCsvText(null);
      setSummary(null);
      setResult(
        `${res.inserted} leads novos adicionados, ${res.duplicate} já existiam, ${res.invalid} inválidos.`
      );
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          onChange={onFileChange}
          style={{ display: "none" }}
        />
        <button onClick={() => inputRef.current?.click()} disabled={pending} style={pgBtn}>
          Importar CSV
        </button>
        {result && <span className="muted" style={{ fontSize: 12 }}>{result}</span>}
      </div>

      {summary && (
        <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 12.5 }}>
          <span>
            {summary.new} leads novos, {summary.duplicate} já existem, {summary.invalid} inválidos (de{" "}
            {summary.total} linhas).
          </span>
          <span style={{ color: "#bf6b6b", fontSize: 11 }}>
            Uma vez confirmado, os novos leads são reportados ao Meta.
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={confirm}
              disabled={pending}
              style={{ ...confirmBtn, background: "#6bbf73", color: "#0b0f0d" }}
            >
              Confirmar
            </button>
            <button
              onClick={cancel}
              disabled={pending}
              style={{ ...confirmBtn, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)" }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StageCounts({ counts, total }: { counts: Record<string, number>; total: number }) {
  if (total === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {FORM_LEAD_STAGES.map((s) => (
        <span
          key={s}
          className="card"
          style={{ padding: "7px 12px", fontSize: 12.5, display: "inline-flex", gap: 7, alignItems: "baseline" }}
        >
          <span style={{ color: STAGE_COLORS[s], fontWeight: 700 }}>{counts[s] ?? 0}</span>
          <span className="muted">{STAGE_LABELS[s]}</span>
        </span>
      ))}
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "12px 14px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: ".4px", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" };
// Looks exactly like a plain <th>, but is a real button so it's keyboard-reachable.
const sortBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  background: "transparent",
  border: "none",
  padding: "12px 14px",
  font: "inherit",
  color: "inherit",
  textTransform: "inherit" as React.CSSProperties["textTransform"],
  letterSpacing: "inherit",
  cursor: "pointer",
};
const td: React.CSSProperties = { padding: "11px 14px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cfd2dc" };
const pgBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
