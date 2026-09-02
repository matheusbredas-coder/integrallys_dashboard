import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="app-shell">
      {/* Aplica o menu recolhido antes da primeira pintura, para não piscar expandido. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `try{if(localStorage.getItem("crm.sidebar.collapsed")==="1"){document.documentElement.dataset.sidebar="collapsed"}}catch(e){}`,
        }}
      />
      <Sidebar email={user.email ?? "Usuário"} />
      <main className="app-main">{children}</main>
    </div>
  );
}
