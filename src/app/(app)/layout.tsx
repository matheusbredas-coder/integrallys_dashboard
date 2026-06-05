import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <Sidebar email="Usuário" />
      <main className="app-main">{children}</main>
    </div>
  );
}
