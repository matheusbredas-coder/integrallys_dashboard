import { getLeadsData } from "@/features/leads/data";
import { LeadsTable } from "@/features/leads/leads-table";
import { getCampaignsData } from "@/features/campaigns/data";
import { CampaignsList } from "@/features/campaigns/campaigns-list";

export default async function MarketingPage() {
  const [leads, campaigns] = await Promise.all([getLeadsData(), getCampaignsData()]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1200, marginInline: "auto" }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Marketing</h1>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Campanhas de reativação</h2>
      <CampaignsList rows={campaigns} />
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Leads</h2>
      <LeadsTable rows={leads} />
    </div>
  );
}
