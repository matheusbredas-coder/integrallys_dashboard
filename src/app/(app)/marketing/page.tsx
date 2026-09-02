import { getFormLeadsData } from "@/features/form-leads/data";
import { FormLeadsTable } from "@/features/form-leads/form-leads-table";
import { LeadsBoard } from "@/features/form-leads/leads-board";
import { getCampaignsData } from "@/features/campaigns/data";
import { CampaignsList } from "@/features/campaigns/campaigns-list";
import { getWaLinksData } from "@/features/wa-links/data";
import { WaLinksPanel } from "@/features/wa-links/wa-links-panel";
import { getPendingDeposits, getRecentDecidedDeposits } from "@/features/bookings/data";
import { DepositsPanel } from "@/features/bookings/deposits-panel";
import { getAgendaWeek } from "@/features/agenda/data";
import { AvailabilityTable } from "@/features/agenda/availability-table";

export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ semana?: string }>;
}) {
  // The week arrows are plain links rather than client state, so which week is on
  // screen lives in the URL — she can leave it on next week and reload.
  const { semana } = await searchParams;
  const [formLeads, campaigns, waLinks, pendingDeposits, recentDeposits, agendaWeek] = await Promise.all([
    getFormLeadsData(),
    getCampaignsData(),
    getWaLinksData(),
    getPendingDeposits(),
    getRecentDecidedDeposits(),
    getAgendaWeek(Number(semana) || 0),
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

      {/* Directly above the calling board on purpose: the caller works the two
          together — pick the lead, read her the times. See features/agenda. */}
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Horários livres na agenda</h2>
      <AvailabilityTable week={agendaWeek} />

      {/* The caller's own board, above the table she'd otherwise have to scan. It
          reuses the rows already fetched for the table — no extra query — and writes
          only its own columns: nothing here moves a lead's funnel stage or reports
          anything to Meta. See features/form-leads/leads-board.tsx. */}
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Ligações do dia</h2>
      <LeadsBoard rows={formLeads} />

      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "8px 0 0" }}>Leads do formulário (Meta)</h2>
      <FormLeadsTable rows={formLeads} />
    </div>
  );
}
