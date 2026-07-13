import type { LeadRow } from "@/features/leads/types";
import { defaultReactivationFunnel } from "./funnel";

// Reactivation-campaign stage labels — distinct from the inbound qualifier's
// FUNNEL_LABELS (leads/columns.ts), which cover a different funnel entirely.
const STAGE_LABEL: Record<string, string> = {
  not_sent: "Não enviado",
  sent: "Enviado",
  engaged: "Engajado",
  touch_up_booked: "Retoque agendado",
  protocol_interested: "Interessada no protocolo",
  lost: "Perdido",
};

const cardStyle: React.CSSProperties = { padding: "10px 12px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", fontSize: 12.5 };

export function CampaignLeadCards({ leads }: { leads: LeadRow[] }) {
  if (leads.length === 0) {
    return <div className="card" style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Nenhuma paciente enviada ainda.</span></div>;
  }

  const byStage = new Map<string, LeadRow[]>();
  for (const stage of defaultReactivationFunnel.stages) byStage.set(stage, []);
  for (const lead of leads) {
    const bucket = byStage.get(lead.funnel_stage);
    if (bucket) bucket.push(lead);
    else byStage.set(lead.funnel_stage, [lead]); // unexpected stage value not in the reactivation funnel
  }

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Pacientes por etapa</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        {[...byStage.entries()].filter(([, rows]) => rows.length > 0).map(([stage, rows]) => (
          <div key={stage}>
            <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".3px", marginBottom: 8 }}>
              {STAGE_LABEL[stage] ?? stage} ({rows.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map((lead) => (
                <div key={lead.id} style={cardStyle}>
                  <div style={{ fontWeight: 600 }}>{lead.name ?? lead.id}</div>
                  <div className="muted">{lead.last_message ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
