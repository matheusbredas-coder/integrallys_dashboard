import { getOverviewSource } from "@/features/overview/data";
import { RecentSales } from "@/features/overview/recent-sales";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const d = await getOverviewSource();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <OverviewDashboard source={d} syncEnabled={process.env.SYNC_ENABLED === "true"} />
      <RecentSales rows={d.recent} />
    </div>
  );
}
