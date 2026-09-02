import { getOverviewSource } from "@/features/overview/data";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const [d, supabase] = await Promise.all([getOverviewSource(), createSupabaseServerClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  const nameByEmail: Record<string, string> = {
    "phcem@hotmail.com": "Pedro",
    "matheus@oversend.com.br": "Matheus",
  };
  const firstName = nameByEmail[user?.email ?? ""] ?? (user?.email?.split("@")[0] ?? "");
  const isGabi = user?.email === "gabiarena10@gmail.com";
  return <OverviewDashboard source={d} syncEnabled={process.env.SYNC_ENABLED === "true"} firstName={firstName} isGabi={isGabi} />;
}
