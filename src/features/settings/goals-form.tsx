"use client";
import { useActionState } from "react";
import type { Goals } from "@/features/overview/types";
import { GOAL_FIELDS } from "./goals";
import { updateGoals, type GoalsFormState } from "./actions";

export function GoalsForm({ goals }: { goals: Goals }) {
  const [state, formAction, pending] = useActionState<GoalsFormState, FormData>(updateGoals, {});

  const input: React.CSSProperties = {
    width: "100%", background: "var(--panel-hi)", border: "1px solid var(--line)",
    borderRadius: 12, padding: "11px 13px", color: "var(--txt)", fontSize: 15, fontWeight: 600,
    fontFamily: "inherit", outline: "none",
  };
  const btn: React.CSSProperties = {
    background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12,
    padding: "11px 18px", fontWeight: 700, fontSize: 14, cursor: "pointer",
  };

  return (
    <form action={formAction} className="card" style={{ padding: 26, display: "flex", flexDirection: "column", gap: 22 }}>
      <div>
        <h2 style={{ fontSize: 17, fontWeight: 700 }}>Metas</h2>
        <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
          Usadas para calcular os medidores de progresso da Visão Geral.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {GOAL_FIELDS.map((f) => (
          <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</span>
            <span className="muted" style={{ fontSize: 12 }}>{f.hint}</span>
            <div style={{ position: "relative", marginTop: 2 }}>
              {f.prefix && (
                <span className="muted" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 600 }}>
                  {f.prefix}
                </span>
              )}
              <input
                name={f.key}
                type="number"
                min={0}
                step={f.step}
                inputMode="decimal"
                required
                defaultValue={goals[f.key]}
                style={{ ...input, paddingLeft: f.prefix ? 38 : 13 }}
              />
            </div>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <button type="submit" disabled={pending} style={{ ...btn, opacity: pending ? 0.7 : 1, cursor: pending ? "default" : "pointer" }}>
          {pending ? "Salvando…" : "Salvar metas"}
        </button>
        <span aria-live="polite" style={{ fontSize: 13, fontWeight: 700 }}>
          {!pending && state.ok && <span style={{ color: "#7bd88f" }}>✓ Metas atualizadas</span>}
          {!pending && state.error && <span style={{ color: "#e06c6c" }}>✕ {state.error}</span>}
        </span>
      </div>
    </form>
  );
}
