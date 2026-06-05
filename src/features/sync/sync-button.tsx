"use client";
import { useState } from "react";
import type { SyncResult, SyncSummary } from "./types";

type Phase = "idle" | "confirm" | "syncing" | "done" | "error";

function fmt(n: unknown) { return typeof n === "number" ? n.toLocaleString("pt-BR") : "—"; }

export function SyncButton({ enabled = false }: { enabled?: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [warnings, setWarnings] = useState<number>(0);
  const [showWarnings, setShowWarnings] = useState(false);
  const [warnList, setWarnList] = useState<string[]>([]);
  const [err, setErr] = useState("");

  async function run() {
    setPhase("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json().catch(() => null)) as SyncResult | null;
      if (data && data.ok) {
        setSummary(data.summary);
        setWarnings(data.warnings.length);
        setWarnList(data.warnings.map((w) => w.message ?? "").filter(Boolean));
        setPhase("done");
      } else {
        setErr(
          !data ? "A sincronização falhou."
          : data.ok ? "A sincronização falhou."
          : data.code === "not_configured" ? "A sincronização ainda não foi configurada."
          : data.message || "A sincronização falhou.",
        );
        setPhase("error");
      }
    } catch {
      setErr("Erro de rede.");
      setPhase("error");
    }
  }

  const btn: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
  const ghost: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", color: "var(--muted)", fontSize: 13.5, cursor: "pointer" };

  if (!enabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 220 }} title="Sincronização Gestek pausada para manutenção">
        <button disabled style={{ ...btn, background: "var(--panel-hi)", color: "var(--muted)", border: "1px solid var(--line)", cursor: "not-allowed" }}>↻ Sincronizar com o Gestek</button>
        <span className="muted" style={{ fontSize: 11 }}>temporariamente desabilitado</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, minWidth: 220 }}>
      {phase === "idle" && <button style={btn} onClick={() => setPhase("confirm")}>↻ Sincronizar com o Gestek</button>}

      {phase === "confirm" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Executar a sincronização agora? Isso atualiza os dados dos pacientes.</span>
          <button style={btn} onClick={run}>Sim, sincronizar</button>
          <button style={ghost} onClick={() => setPhase("idle")}>Cancelar</button>
        </div>
      )}

      {phase === "syncing" && <button style={{ ...btn, opacity: 0.7, cursor: "default" }} disabled>Sincronizando…</button>}

      {phase === "done" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#7bd88f", fontWeight: 700 }}>
            ✓ Sincronizado — {fmt(summary?.patients_inserted)} novos pacientes, {fmt(summary?.vendas_upserted)} vendas,{" "}
            <span style={{ cursor: warnings ? "pointer" : "default", textDecoration: warnings ? "underline" : "none" }} onClick={() => warnings && setShowWarnings((s) => !s)}>{warnings} avisos</span>
          </div>
          {showWarnings && warnList.length > 0 && (
            <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", color: "var(--muted)", maxWidth: 360 }}>
              {warnList.slice(0, 8).map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          )}
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Sincronizar novamente</button>
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#e06c6c", fontWeight: 700 }}>✕ {err}</div>
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Tentar novamente</button>
        </div>
      )}
    </div>
  );
}
