import { getLeadsData } from "@/features/leads/data";
import { LeadsTable } from "@/features/leads/leads-table";
import { getFormLeadsData } from "@/features/form-leads/data";
import { FormLeadsTable } from "@/features/form-leads/form-leads-table";
import { getCampaignsData } from "@/features/campaigns/data";
import { CampaignsList } from "@/features/campaigns/campaigns-list";
import { getWaLinksData } from "@/features/wa-links/data";
import { WaLinksPanel } from "@/features/wa-links/wa-links-panel";

export default async function MarketingPage() {
  const [leads, formLeads, campaigns, waLinks] = await Promise.all([
    getLeadsData(),
    getFormLeadsData(),
    getCampaignsData(),
    getWaLinksData(),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1200, marginInline: "auto" }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Marketing</h1>

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Link de WhatsApp (clique para conversar)</h2>
      <WaLinksPanel rows={waLinks} />

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Campanhas de reativação</h2>
      <CampaignsList rows={campaigns} />

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Leads do formulário (Meta)</h2>
      <FormLeadsTable rows={formLeads} />

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Leads</h2>
      <LeadsTable rows={leads} />
    </div>
  );
}
