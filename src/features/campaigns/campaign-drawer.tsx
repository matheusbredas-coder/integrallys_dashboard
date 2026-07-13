"use client";
import { useEffect, useState } from "react";
import type { CampaignRow } from "./types";
import type { LeadRow } from "@/features/leads/types";
import { getCampaignDetail, previewPublish, publishCampaign } from "./actions";
import { CampaignAudienceForm } from "./campaign-audience-form";
import { CampaignCopyEditor } from "./campaign-copy-editor";
import { CampaignLeadCards } from "./campaign-lead-cards";
import { CampaignMetrics } from "./campaign-metrics";

type PublishPhase = "idle" | "checking" | "confirm" | "blocked" | "publishing" | "done" | "error";

const btnStyle: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer" };
const ghostStyle: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 14px", color: "var(--muted)", fontSize: 13, cursor: "pointer" };

function PublishGate({ campaignId, status }: { campaignId: string; status: CampaignRow["status"] }) {
  const [phase, setPhase] = useState<PublishPhase>("idle");
  const [count, setCount] = useState(0);
  const [reason, setReason] = useState<string | null>(null);

  if (status !== "draft") {
    return <span className="muted" style={{ fontSize: 13 }}>Status: {status}{status === "published" ? " — mensagens serão enviadas pelo worker do bot" : ""}</span>;
  }

  async function check() {
    setPhase("checking");
    const result = await previewPublish(campaignId);
    if ("error" in result) { setReason(result.error); setPhase("blocked"); return; }
    setCount(result.count);
    if (result.blockedReason) { setReason(result.blockedReason); setPhase("blocked"); }
    else { setReason(null); setPhase("confirm"); }
  }

  async function confirm() {
    setPhase("publishing");
    const result = await publishCampaign(campaignId);
    if ("error" in result) { setReason(result.error); setPhase("blocked"); return; }
    setCount(result.count);
    setPhase("done");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      {phase === "idle" && <button style={btnStyle} onClick={check}>Publicar campanha</button>}
      {phase === "checking" && <button style={{ ...btnStyle, opacity: 0.7 }} disabled>Verificando…</button>}
      {phase === "confirm" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13 }}>Confirma o envio para <strong>{count}</strong> paciente{count === 1 ? "" : "s"}?</span>
          <button style={btnStyle} onClick={confirm}>Sim, publicar</button>
          <button style={ghostStyle} onClick={() => setPhase("idle")}>Cancelar</button>
        </div>
      )}
      {phase === "publishing" && <button style={{ ...btnStyle, opacity: 0.7 }} disabled>Publicando…</button>}
      {phase === "blocked" && (
        <div>
          <div style={{ color: "#e06c6c", fontSize: 12.5 }}>{reason}</div>
          <button style={{ ...ghostStyle, marginTop: 6 }} onClick={() => setPhase("idle")}>Voltar</button>
        </div>
      )}
      {phase === "done" && <div style={{ color: "#7bd88f", fontWeight: 700, fontSize: 13 }}>✓ Campanha publicada para {count} paciente{count === 1 ? "" : "s"}</div>}
    </div>
  );
}

export function CampaignDrawer({ campaignId, onClose }: { campaignId: string; onClose: () => void }) {
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCampaignDetail(campaignId).then((result) => {
      if (cancelled) return;
      if ("error" in result) setError(result.error);
      else { setCampaign(result.campaign); setLeads(result.leads); }
    });
    return () => { cancelled = true; };
  }, [campaignId]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(720px, 92vw)", background: "var(--bg)", borderLeft: "1px solid var(--line)", zIndex: 41, overflowY: "auto", padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{campaign?.name ?? "Campanha"}</h2>
          <button style={ghostStyle} onClick={onClose}>Fechar ✕</button>
        </div>
        {error && <div style={{ color: "#e06c6c", fontSize: 13 }}>{error}</div>}
        {campaign && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <PublishGate campaignId={campaign.id} status={campaign.status} />
            <CampaignAudienceForm campaignId={campaign.id} filter={campaign.audience_filter} initialCount={campaign.audience_count} />
            <CampaignCopyEditor campaignId={campaign.id} tracks={campaign.tracks} />
            <CampaignMetrics campaign={campaign} />
            <CampaignLeadCards leads={leads} />
          </div>
        )}
      </aside>
    </>
  );
}
