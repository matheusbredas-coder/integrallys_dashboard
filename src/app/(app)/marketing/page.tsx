import { getLeadsData } from "@/features/leads/data";
import { LeadsTable } from "@/features/leads/leads-table";
import { getFormLeadsData } from "@/features/form-leads/data";
import { FormLeadsTable } from "@/features/form-leads/form-leads-table";
import { getCampaignsData } from "@/features/campaigns/data";
import { CampaignsList } from "@/features/campaigns/campaigns-list";
import { getWaLinksData } from "@/features/wa-links/data";
import { WaLinksPanel } from "@/features/wa-links/wa-links-panel";
import { getPendingDeposits, getRecentDecidedDeposits } from "@/features/bookings/data";
import { DepositsPanel } from "@/features/bookings/deposits-panel";

export default async function MarketingPage() {
  const [leads, formLeads, campaigns, waLinks, pendingDeposits, recentDeposits] = await Promise.all([
    getLeadsData(),
    getFormLeadsData(),
    getCampaignsData(),
    getWaLinksData(),
    getPendingDeposits(),
    getRecentDecidedDeposits(),
  ]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1200, marginInline: "auto" }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Marketing</h1>

      {/* First on the page on purpose: a lead is sitting in a WhatsApp
          conversation waiting on this decision, and her slot is only held for
          30 minutes. Everything else here can wait. */}
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
        Sinais aguardando conferência{pendingDeposits.length > 0 ? ` (${pendingDeposits.length})` : ""}
      </h2>
      <DepositsPanel pending={pendingDeposits} recent={recentDeposits} />

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Link de WhatsApp (clique para conversar)</h2>
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
