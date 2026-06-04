import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh" }}>
      <Sidebar email={user.email ?? "User"} />
      <main style={{ padding: "30px 34px" }}>{children}</main>
    </div>
  );
}
