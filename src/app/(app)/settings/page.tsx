import { getGoals } from "@/features/settings/data";
import { GoalsForm } from "@/features/settings/goals-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const goals = await getGoals();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 720 }}>
      <header>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Configurações</h1>
        <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
          Defina as metas usadas nos medidores da Visão Geral.
        </p>
      </header>
      <GoalsForm goals={goals} />
    </div>
  );
}
