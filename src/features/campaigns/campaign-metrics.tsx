import type { CampaignRow } from "./types";

const tileStyle: React.CSSProperties = { padding: "14px 16px", borderRadius: 14, background: "var(--panel-hi)", border: "1px solid var(--line)", flex: 1 };
const numStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700 };

export function CampaignMetrics({ campaign }: { campaign: CampaignRow }) {
  const conversion = campaign.audience_count > 0 ? Math.round((campaign.booked_count / campaign.audience_count) * 100) : 0;
  const tiles: { label: string; value: number | string }[] = [
    { label: "Enviadas", value: campaign.sent_count },
    { label: "Entregues", value: campaign.delivered_count },
    { label: "Responderam", value: campaign.replied_count },
    { label: "Agendaram retoque", value: campaign.booked_count },
    { label: "Conversão", value: `${conversion}%` },
  ];
  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Métricas</h3>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {tiles.map((t) => (
          <div key={t.label} style={tileStyle}>
            <div style={numStyle}>{t.value}</div>
            <div className="muted" style={{ fontSize: 12 }}>{t.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
