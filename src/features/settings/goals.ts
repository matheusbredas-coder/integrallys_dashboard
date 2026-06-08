import type { Goals } from "@/features/overview/types";

// Targets the clinic is measured against on the Overview gauges. These are the
// fallbacks when a key is missing from app_settings — keep in sync with the
// seed in db/migrations/003_app_settings.sql.
export const DEFAULT_GOALS: Goals = {
  monthly_revenue_goal: 50000,
  monthly_new_patient_goal: 30,
  avg_ticket_goal: 280,
};

// Drives both the settings form (render order, labels, prefixes) and the
// validator below, so the two can never disagree on which keys exist.
export const GOAL_FIELDS = [
  { key: "monthly_revenue_goal", label: "Meta de faturamento mensal", hint: "Faturamento total esperado por mês.", prefix: "R$", step: 100 },
  { key: "monthly_new_patient_goal", label: "Meta de novos pacientes (mês)", hint: "Quantos pacientes novos por mês.", prefix: "", step: 1 },
  { key: "avg_ticket_goal", label: "Ticket médio alvo", hint: "Valor médio desejado por venda.", prefix: "R$", step: 10 },
] as const satisfies ReadonlyArray<{ key: keyof Goals; label: string; hint: string; prefix: string; step: number }>;

export type GoalsParseResult = { goals: Goals; error?: undefined } | { goals?: undefined; error: string };

// Pure validator (no I/O) so it's unit-testable and reusable on the server.
// Accepts a comma OR dot decimal separator (pt-BR users type commas).
export function parseGoals(raw: Partial<Record<keyof Goals, string>>): GoalsParseResult {
  const out = {} as Goals;
  for (const f of GOAL_FIELDS) {
    const value = (raw[f.key] ?? "").trim();
    if (value === "") return { error: `Preencha "${f.label}".` };
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n)) return { error: `"${f.label}" deve ser um número válido.` };
    if (n < 0) return { error: `"${f.label}" não pode ser negativo.` };
    out[f.key] = n;
  }
  return { goals: out };
}
