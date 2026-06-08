import { getGoals } from "@/features/settings/data";
import { GoalsForm } from "@/features/settings/goals-form";
import { AttendanceImportForm } from "@/features/attendance/import-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/app/(app)/signout/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const goals = await getGoals();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 720 }}>
      <header>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Configurações</h1>
        <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
          Defina as metas usadas nos medidores da Visão Geral e importe o relatório de atendimentos.
        </p>
      </header>

      <section className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Aparência</h2>
          <p className="muted" style={{ fontSize: 13 }}>Escolha entre o tema escuro e o tema claro.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Tema</span>
          <ThemeToggle />
        </div>
      </section>

      <GoalsForm goals={goals} />
      <AttendanceImportForm />

      <section className="card" style={{ padding: "24px 28px" }}>
        <div style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Conta</h2>
          <p className="muted" style={{ fontSize: 13 }}>Encerrar a sessão atual.</p>
        </div>
        <form action={signOut}>
          <button type="submit" style={{ fontSize: 14, fontWeight: 600, padding: "8px 18px", borderRadius: 8, border: "1px solid var(--border)", background: "transparent", cursor: "pointer", color: "var(--destructive, #e53e3e)" }}>
            Sair
          </button>
        </form>
      </section>
    </div>
  );
}
