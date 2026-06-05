"use client";
import { useActionState, useState, startTransition } from "react";
import { importAttendance, type ImportFormState } from "./actions";

export function AttendanceImportForm() {
  const [state, formAction, pending] = useActionState<ImportFormState, FormData>(importAttendance, {});
  // Hold the File in state: React 19 resets <form action> inputs after each submission,
  // so we can't rely on the file input keeping its value between "preview" and "apply".
  const [file, setFile] = useState<File | null>(null);
  const summary = state.summary;
  const previewed = !!summary && !summary.applied;

  const submit = (intent: "preview" | "apply") => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("intent", intent);
    startTransition(() => formAction(fd));
  };

  const btn: React.CSSProperties = {
    background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12,
    padding: "11px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    ...btn, background: "transparent", color: "var(--txt)", border: "1px solid var(--line)",
  };

  return (
    <div className="card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 700 }}>Relatório de atendimentos</h2>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          Importe o .xlsx do Gestek (Relatório de Atendimentos) para registrar realizados, cancelados e faltas.
          A pré-visualização não grava nada — confira os números antes de aplicar.
        </p>
      </div>

      <label
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
          background: "var(--panel-hi)", border: "1px dashed var(--line)", borderRadius: 12,
          padding: "13px 15px", cursor: "pointer", fontSize: 14, fontWeight: 600,
        }}
      >
        <span style={{ color: file ? "var(--txt)" : "var(--muted)" }}>
          {file?.name || "Escolher arquivo .xlsx…"}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>procurar</span>
        <input
          name="file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
      </label>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => submit("preview")} disabled={pending || !file} style={{ ...btnGhost, opacity: pending || !file ? 0.6 : 1, cursor: pending || !file ? "default" : "pointer" }}>
          {pending ? "Processando…" : "Pré-visualizar"}
        </button>
        {previewed && (
          <button type="button" onClick={() => submit("apply")} disabled={pending} style={{ ...btn, opacity: pending ? 0.7 : 1 }}>
            {pending ? "Aplicando…" : `Confirmar e aplicar (${summary!.matched})`}
          </button>
        )}
        <span aria-live="polite" style={{ fontSize: 13, fontWeight: 700 }}>
          {!pending && summary?.applied && (
            <span style={{ color: "#7bd88f" }}>✓ {summary.written} agendamento(s) atualizado(s)</span>
          )}
          {!pending && state.error && <span style={{ color: "#e06c6c" }}>✕ {state.error}</span>}
        </span>
      </div>

      {summary && <Summary summary={summary} />}
    </div>
  );
}

function Summary({ summary }: { summary: ImportFormState["summary"] & {} }) {
  const stat = (label: string, value: number, color?: string) => (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 700, color }}>{value}</span>
    </div>
  );
  return (
    <div style={{ background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)" }}>
        {summary.applied ? "Resultado da importação" : "Pré-visualização (nada gravado ainda)"}
      </div>
      {stat("Linhas no relatório", summary.totalRows)}
      {stat("Correspondências encontradas", summary.matched, "#7bd88f")}
      {summary.applied && stat("Agendamentos gravados", summary.written, "#7bd88f")}
      {stat("Ignoradas (agendado/futuro)", summary.skippedFuture)}
      {stat("Sem correspondência", summary.unmatched, summary.unmatched ? "#e0b66c" : undefined)}
      {stat("Status não reconhecido", summary.unknownStatus, summary.unknownStatus ? "#e0b66c" : undefined)}

      {summary.unknownLabels.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <span className="muted">Status desconhecidos: </span>
          <span style={{ fontWeight: 600 }}>{summary.unknownLabels.join(", ")}</span>
        </div>
      )}
      {summary.unmatchedSamples.length > 0 && (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <div className="muted" style={{ marginBottom: 4 }}>Exemplos sem correspondência:</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 2 }}>
            {summary.unmatchedSamples.slice(0, 8).map((r, i) => (
              <li key={i}>{r.dateText} — {r.cliente} <span className="muted">({r.statusText})</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
