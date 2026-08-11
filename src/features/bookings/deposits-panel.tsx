"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDeposit, rejectDeposit } from "./actions";
import type { BookingRow, PendingDeposit } from "./types";

const gold: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "9px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
const ghost: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 14px", color: "var(--muted)", fontSize: 13, cursor: "pointer" };
const meta: React.CSSProperties = { fontSize: 12, color: "var(--muted)" };

/** The clinic reads times in its own timezone, never the browser's. */
const SP = "America/Sao_Paulo";

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: SP, weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: SP, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL: Record<string, string> = {
  approved: "Aprovado, agendando…",
  booked: "Agendado",
  rejected: "Recusado",
  slot_lost: "Horário perdido",
};

function DepositCard({ deposit }: { deposit: PendingDeposit }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(action: typeof approveDeposit) {
    setError(null);
    startTransition(async () => {
      const res = await action(deposit.id);
      if ("error" in res) { setError(res.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="card" style={{ padding: 16, display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      {deposit.proof_url ? (
        // Opens full size in a new tab: a deposit is approved on the strength of
        // what the receipt says, and the thumbnail is rarely legible enough.
        <a href={deposit.proof_url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived Supabase URL; not a static asset */}
          <img
            src={deposit.proof_url}
            alt={`Comprovante de ${deposit.cliente_nome ?? deposit.phone}`}
            style={{ width: 128, height: 128, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)" }}
          />
        </a>
      ) : (
        <div style={{ width: 128, height: 128, borderRadius: 12, border: "1px dashed var(--line)", display: "grid", placeItems: "center", ...meta }}>
          sem imagem
        </div>
      )}

      <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column", gap: 4 }}>
        <strong style={{ fontSize: 15 }}>{deposit.cliente_nome ?? "Sem nome"}</strong>
        <span style={meta}>{deposit.phone}</span>
        <span style={{ fontSize: 13.5 }}>Avaliação {formatSlot(deposit.slot_at)}</span>
        <span style={meta}>Comprovante recebido {formatWhen(deposit.proof_at)}</span>
        {error && <span style={{ ...meta, color: "var(--danger, #e5484d)" }}>{error}</span>}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button style={{ ...gold, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={() => decide(approveDeposit)}>
          Aprovar
        </button>
        <button style={{ ...ghost, opacity: pending ? 0.6 : 1 }} disabled={pending} onClick={() => decide(rejectDeposit)}>
          Recusar
        </button>
      </div>
    </div>
  );
}

export function DepositsPanel({ pending, recent }: { pending: PendingDeposit[]; recent: BookingRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {pending.length === 0 ? (
        <div className="card" style={{ padding: 16, ...meta }}>Nenhum comprovante aguardando conferência.</div>
      ) : (
        pending.map((deposit) => <DepositCard key={deposit.id} deposit={deposit} />)
      )}

      {recent.length > 0 && (
        <details>
          <summary style={{ ...meta, cursor: "pointer" }}>Decididos recentemente ({recent.length})</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {recent.map((row) => (
              <div key={row.id} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13 }}>
                <span style={{ minWidth: 150 }}>{row.cliente_nome ?? row.phone}</span>
                <span style={meta}>{formatSlot(row.slot_at)}</span>
                <span style={{ ...meta, marginLeft: "auto" }}>{STATUS_LABEL[row.status] ?? row.status}</span>
                {row.note && <span style={{ ...meta, fontStyle: "italic" }}>{row.note}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
