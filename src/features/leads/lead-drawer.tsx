"use client";
import { useEffect, useState } from "react";
import type { LeadRow, LeadMessage } from "./types";
import { LEAD_COLUMNS, formatLeadCell } from "./columns";
import { getLeadConversation } from "./actions";

const ROLE_LABEL: Record<LeadMessage["role"], string> = { lead: "Lead", bot: "Bot", human: "Atendente" };

function time(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function LeadDrawer({ row, onClose }: { row: LeadRow; onClose: () => void }) {
  const [msgs, setMsgs] = useState<LeadMessage[] | null>(null);
  useEffect(() => {
    let alive = true;
    getLeadConversation(row.id).then((m) => { if (alive) setMsgs(m); }).catch(() => { if (alive) setMsgs([]); });
    return () => { alive = false; };
  }, [row.id]);

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 40 }} />
      <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "92vw", background: "#0e0e10", borderLeft: "1px solid var(--line)", zIndex: 41, overflowY: "auto", padding: 26 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-.4px" }}>{row.name ?? row.id}</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ display: "grid", gap: 2, marginBottom: 24 }}>
          {LEAD_COLUMNS.filter((c) => c.key !== "name").map((c) => (
            <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="muted" style={{ fontSize: 12.5 }}>{c.label}</span>
              <span style={{ fontSize: 13, textAlign: "right", maxWidth: 280, overflowWrap: "anywhere" }}>{formatLeadCell(row, c.key)}</span>
            </div>
          ))}
        </div>
        <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Conversa</h3>
        {msgs === null && <p className="muted" style={{ fontSize: 13 }}>Carregando…</p>}
        {msgs?.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nenhuma mensagem.</p>}
        {msgs?.map((m) => (
          <div key={m.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: m.role === "bot" ? "var(--gold)" : "#cfd2dc" }}>{ROLE_LABEL[m.role]}</span>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{time(m.created_at)}</span>
            </div>
            <div style={{ fontSize: 13, color: "#cfd2dc", marginTop: 3, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.content}</div>
          </div>
        ))}
      </aside>
    </>
  );
}
