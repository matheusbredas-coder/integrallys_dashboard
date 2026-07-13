"use client";
import { useState, useTransition } from "react";
import type { CampaignRow } from "./types";
import { createCampaign } from "./actions";
import { CampaignDrawer } from "./campaign-drawer";

const btnStyle: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };

export function CampaignsList({ rows }: { rows: CampaignRow[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const result = await createCampaign();
      if ("error" in result) setError(result.error);
      else setSelected(result.id);
    });
  }

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}>{rows.length} campanha{rows.length === 1 ? "" : "s"}</span>
        <button style={{ ...btnStyle, opacity: pending ? 0.7 : 1 }} disabled={pending} onClick={create}>+ Nova campanha</button>
      </div>
      {error && <div style={{ padding: 12, color: "#e06c6c", fontSize: 12.5 }}>{error}</div>}
      <div>
        {rows.length === 0 && <div style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Nenhuma campanha ainda.</span></div>}
        {rows.map((c) => (
          <div key={c.id} onClick={() => setSelected(c.id)} style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--panel-hi)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <span style={{ fontWeight: 600 }}>{c.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>{c.status} · {c.audience_count} pacientes</span>
          </div>
        ))}
      </div>
      {selected && <CampaignDrawer campaignId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
