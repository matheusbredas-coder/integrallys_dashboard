import { getLeadsData } from "@/features/leads/data";
import { LeadsTable } from "@/features/leads/leads-table";

export default async function MarketingPage() {
  const leads = await getLeadsData();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 1200, marginInline: "auto" }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Marketing</h1>
      <LeadsTable rows={leads} />
    </div>
  );
}
