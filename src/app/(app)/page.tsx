import { getOverviewData } from "@/features/overview/data";
import { ChatLauncher } from "@/features/chat/chat-launcher";
import { SyncButton } from "@/features/sync/sync-button";
import { KpiCards } from "@/features/overview/kpi-cards";
import { Gauges } from "@/features/overview/gauges";
import { RevenueChart } from "@/features/overview/revenue-chart";
import { RecentSales } from "@/features/overview/recent-sales";
import { TopProcedures } from "@/features/overview/top-procedures";

export default async function OverviewPage() {
  const d = await getOverviewData();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ChatLauncher />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Hello, Matheus</h1>
          <p className="muted" style={{ marginTop: 4 }}>Here&apos;s your clinic at a glance.</p>
        </div>
        <SyncButton />
      </div>
      <KpiCards kpi={d.kpi} />
      <Gauges gauges={d.gauges} />
      <RevenueChart data={d.months} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <RecentSales rows={d.recent} />
        <TopProcedures rows={d.topProcedures} />
      </div>
    </div>
  );
}
