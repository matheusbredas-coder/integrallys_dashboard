"use client";
import { useState, useTransition } from "react";
import type { ReactivationFunnel, FunnelStep, ApprovalStatus, FunnelMessage } from "./funnel";
import type { Track } from "./classify";
import { updateCampaignCopy } from "./actions";

const STATUS_LABEL: Record<ApprovalStatus, string> = { draft: "Rascunho", pending: "Enviado p/ aprovação", approved: "Aprovado", rejected: "Rejeitado" };
const TRACKS: { key: Track; label: string }[] = [{ key: "rosto", label: "🟦 Rosto" }, { key: "medidas", label: "🟩 Medidas" }];

const textareaStyle: React.CSSProperties = { width: "100%", minHeight: 64, padding: 10, borderRadius: 10, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13, resize: "vertical" };
const selectStyle: React.CSSProperties = { padding: "6px 10px", borderRadius: 8, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 12 };
const btnStyle: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

function messagesFor(step: FunnelStep, track: Track): FunnelMessage[] {
  return step.overrides?.[track] ?? step.messages;
}

function withEditedText(step: FunnelStep, track: Track, msgIndex: number, text: string): FunnelStep {
  const current = messagesFor(step, track);
  const updated = current.map((m, i) => (i === msgIndex ? { ...m, text } : m));
  if (step.overrides?.[track]) {
    return { ...step, overrides: { ...step.overrides, [track]: updated } };
  }
  // Editing a shared (non-overridden) step edits the base `messages` for both tracks.
  return { ...step, messages: updated };
}

export function CampaignCopyEditor({ campaignId, tracks }: { campaignId: string; tracks: ReactivationFunnel }) {
  const [funnel, setFunnel] = useState<ReactivationFunnel>(tracks);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function editStep(stepId: number, track: Track, msgIndex: number, text: string) {
    setSaved(false);
    setFunnel((f) => ({ ...f, steps: f.steps.map((s) => (s.id === stepId ? withEditedText(s, track, msgIndex, text) : s)) }));
  }

  function editStatus(stepId: number, approvalStatus: ApprovalStatus) {
    setSaved(false);
    setFunnel((f) => ({ ...f, steps: f.steps.map((s) => (s.id === stepId ? { ...s, approvalStatus } : s)) }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCampaignCopy(campaignId, funnel);
      if ("error" in result) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Copy da campanha</h3>
      {funnel.steps.map((step) => (
        <div key={step.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>#{step.id} · {step.tactic} · {step.delayHint}</span>
            <select style={selectStyle} value={step.approvalStatus} onChange={(e) => editStatus(step.id, e.target.value as ApprovalStatus)}>
              {(Object.keys(STATUS_LABEL) as ApprovalStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {TRACKS.map(({ key, label }) => (
              <div key={key}>
                <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>{label}</div>
                {messagesFor(step, key).map((m, i) => (
                  <textarea key={i} style={{ ...textareaStyle, marginBottom: 6 }} value={m.text ?? ""}
                    onChange={(e) => editStep(step.id, key, i, e.target.value)} disabled={m.type !== "text"} />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={{ ...btnStyle, opacity: pending ? 0.7 : 1 }} disabled={pending} onClick={save}>
          {pending ? "Salvando…" : "Salvar copy"}
        </button>
        {saved && !pending && <span className="muted" style={{ fontSize: 12.5 }}>✓ Salvo</span>}
      </div>
      {error && <div style={{ color: "#e06c6c", fontSize: 12.5 }}>{error}</div>}
    </div>
  );
}
