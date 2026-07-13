"use client";
import { useState, useTransition } from "react";
import type { AudienceFilter } from "./types";
import { updateCampaignFilter } from "./actions";

const inputStyle: React.CSSProperties = { padding: "9px 12px", borderRadius: 10, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13, width: "100%" };
const labelStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".3px", display: "block", marginBottom: 6 };
const btnStyle: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" };

export function CampaignAudienceForm({ campaignId, filter, initialCount }: { campaignId: string; filter: AudienceFilter; initialCount: number }) {
  const [form, setForm] = useState<AudienceFilter>(filter);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateCampaignFilter(campaignId, form);
      if ("error" in result) setError(result.error);
      else setCount(result.audienceCount);
    });
  }

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Audiência</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={labelStyle}>Meses desde a última visita (mínimo)</label>
          <input type="number" style={inputStyle} value={form.minMonthsSinceLastVisit ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, minMonthsSinceLastVisit: e.target.value === "" ? null : Number(e.target.value) }))} />
        </div>
        <div>
          <label style={labelStyle}>Procedimento (contém)</label>
          <input type="text" style={inputStyle} value={form.procedureKeyword ?? ""} placeholder="ex.: BOTOX, MONJAURO"
            onChange={(e) => setForm((f) => ({ ...f, procedureKeyword: e.target.value.trim() === "" ? null : e.target.value }))} />
        </div>
        <div>
          <label style={labelStyle}>Gasto total mínimo (R$)</label>
          <input type="number" style={inputStyle} value={form.minTotalSpend ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, minTotalSpend: e.target.value === "" ? null : Number(e.target.value) }))} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
          <input type="checkbox" checked={form.neverRebooked} onChange={(e) => setForm((f) => ({ ...f, neverRebooked: e.target.checked }))} />
          <label style={{ fontSize: 13 }}>Nunca retornou (só uma visita)</label>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={{ ...btnStyle, opacity: pending ? 0.7 : 1 }} disabled={pending} onClick={save}>
          {pending ? "Atualizando…" : "Atualizar audiência"}
        </button>
        <span className="muted" style={{ fontSize: 13 }}>{count} paciente{count === 1 ? "" : "s"} incluída{count === 1 ? "" : "s"}</span>
      </div>
      {error && <div style={{ color: "#e06c6c", fontSize: 12.5 }}>{error}</div>}
    </div>
  );
}
