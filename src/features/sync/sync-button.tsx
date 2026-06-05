"use client";
import { useState } from "react";
import type { SyncResult, SyncSummary } from "./trigger";

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
          !data ? "Sync failed."
          : data.ok ? "Sync failed."
          : data.code === "not_configured" ? "Sync not configured yet."
          : data.message || "Sync failed.",
        );
        setPhase("error");
      }
    } catch {
      setErr("Network error.");
      setPhase("error");
    }
  }

  const btn: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
  const ghost: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", color: "var(--muted)", fontSize: 13.5, cursor: "pointer" };

  if (!enabled) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, minWidth: 220 }} title="Gestek sync is paused for maintenance">
        <button disabled style={{ ...btn, background: "var(--panel-hi)", color: "var(--muted)", border: "1px solid var(--line)", cursor: "not-allowed" }}>↻ Sync Gestek</button>
        <span className="muted" style={{ fontSize: 11 }}>temporarily disabled</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, minWidth: 220 }}>
      {phase === "idle" && <button style={btn} onClick={() => setPhase("confirm")}>↻ Sync Gestek</button>}

      {phase === "confirm" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Run sync now? Updates patient data.</span>
          <button style={btn} onClick={run}>Yes, sync</button>
          <button style={ghost} onClick={() => setPhase("idle")}>Cancel</button>
        </div>
      )}

      {phase === "syncing" && <button style={{ ...btn, opacity: 0.7, cursor: "default" }} disabled>Syncing…</button>}

      {phase === "done" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#7bd88f", fontWeight: 700 }}>
            ✓ Synced — {fmt(summary?.patients_updated)} updated, {fmt(summary?.new_patients_inserted)} new,{" "}
            <span style={{ cursor: warnings ? "pointer" : "default", textDecoration: warnings ? "underline" : "none" }} onClick={() => warnings && setShowWarnings((s) => !s)}>{warnings} warnings</span>
          </div>
          {showWarnings && warnList.length > 0 && (
            <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", color: "var(--muted)", maxWidth: 360 }}>
              {warnList.slice(0, 8).map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          )}
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Sync again</button>
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#e06c6c", fontWeight: 700 }}>✕ {err}</div>
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Try again</button>
        </div>
      )}
    </div>
  );
}
