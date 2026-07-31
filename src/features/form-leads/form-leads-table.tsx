"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import { updateFormLeadStage } from "./actions";
import { FORM_LEAD_STAGES, STAGE_LABELS, type FormLeadRow, type FormLeadStage } from "./types";

const PAGE = 25;

// Only stages the user actually moves leads to get a colour; `novo` stays neutral so the
// coloured ones read as "someone has touched this".
const STAGE_COLORS: Record<FormLeadStage, string> = {
  novo: "var(--muted)",
  contatado: "#7aa2f7",
  qualificado: "#b48ead",
  agendado: "#e0af68",
  ganho: "#6bbf73",
  perdido: "#bf6b6b",
};

export function FormLeadsTable({ rows }: { rows: FormLeadRow[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  // Stage edits applied locally the moment they're made, so the <select> doesn't snap back
  // to the server value while the action and the router refresh are in flight.
  const [pendingStages, setPendingStages] = useState<Record<string, FormLeadStage>>({});
  const [error, setError] = useState<string | null>(null);

  const stageOf = (r: FormLeadRow): FormLeadStage => pendingStages[r.id] ?? r.stage;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      [r.name, r.phone, r.email, r.campaign, r.form_name].some((v) =>
        String(v ?? "").toLowerCase().includes(needle)
      )
    );
  }, [rows, q]);

  const counts = useMemo(() => {
    const acc = {} as Record<string, number>;
    for (const r of rows) {
      const s = pendingStages[r.id] ?? r.stage;
      acc[s] = (acc[s] ?? 0) + 1;
    }
    return acc;
  }, [rows, pendingStages]);

  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <StageCounts counts={counts} total={rows.length} />

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Pesquisar por nome, telefone, campanha…"
            style={{ flex: 1, maxWidth: 340, padding: "10px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13 }}
          />
          <span className="muted" style={{ fontSize: 12 }}>{filtered.length} leads</span>
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
                {["Nome", "Telefone", "E-mail", "Campanha", "Formulário", "Recebido", "Etapa"].map((label) => (
                  <th key={label} style={th}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ ...td, color: "#fff", fontWeight: 600 }}>{r.name ?? "—"}</td>
                  <td style={td}>
                    {r.phone ? (
                      <a href={`https://wa.me/${r.phone}`} target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                        {r.phone}
                      </a>
                    ) : "—"}
                  </td>
                  <td style={td}>{r.email ?? "—"}</td>
                  <td style={td}>{r.campaign ?? "—"}</td>
                  <td style={td}>{r.form_name ?? "—"}</td>
                  <td style={td}>{formatReceived(r)}</td>
                  <td style={{ ...td, overflow: "visible" }}>
                    <StageSelect
                      leadId={r.id}
                      value={stageOf(r)}
                      onOptimistic={(stage) => setPendingStages((p) => ({ ...p, [r.id]: stage }))}
                      onRevert={() => setPendingStages((p) => { const next = { ...p }; delete next[r.id]; return next; })}
                      onError={setError}
                    />
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

  function change(next: FormLeadStage) {
    onError(null);
    onOptimistic(next);
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

  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => change(e.target.value as FormLeadStage)}
      style={{
        background: "var(--panel-hi)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "6px 10px",
        fontSize: 12.5,
        fontWeight: 600,
        color: STAGE_COLORS[value] ?? "var(--txt)",
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

/** Prefer the form's own submission time; fall back to when we ingested it. */
function formatReceived(r: FormLeadRow): string {
  const d = new Date(r.submitted_at ?? r.created_at);
  return isNaN(d.getTime()) ? "—" : formatDate(d);
}

const th: React.CSSProperties = { textAlign: "left", padding: "12px 14px", color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", fontSize: 11, letterSpacing: ".4px", whiteSpace: "nowrap", borderBottom: "1px solid var(--line)" };
const td: React.CSSProperties = { padding: "11px 14px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#cfd2dc" };
const pgBtn: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "var(--muted)" };
