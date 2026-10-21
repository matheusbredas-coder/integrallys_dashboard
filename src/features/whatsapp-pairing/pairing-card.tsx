"use client";

import { useEffect, useState, useTransition } from "react";
import { generatePairing, getWhatsAppState } from "./actions";
import type { ConnectionState, PairingResult } from "./evolution";

const OK = "#6bbf73";
const BAD = "#e2875a";
const CLINIC_PHONE = "27 99968-7380";

const LABEL: Record<ConnectionState, string> = {
  open: "Conectado",
  connecting: "Aguardando o celular…",
  close: "Desconectado",
  unknown: "Não foi possível verificar",
};

/**
 * Reconnects the clinic's WhatsApp to Evolution: shows whether it is linked and,
 * when it isn't, generates a QR code and/or an 8-letter pairing code. While a code
 * is on screen it re-checks every few seconds and clears it once the phone links.
 */
export function WhatsAppPairingCard({ initialState }: { initialState: ConnectionState }) {
  const [state, setState] = useState<ConnectionState>(initialState);
  const [result, setResult] = useState<PairingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    const res = await getWhatsAppState();
    if ("error" in res) { setError(res.error); setState("unknown"); return; }
    setState(res.state);
    if (res.state === "open") setResult(null);
  }

  // Poll while a code is showing, so the box turns green by itself once linked.
  const waiting = Boolean(result?.qr || result?.pairingCode);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void refresh(); }, 4000);
    return () => clearInterval(t);
  }, [waiting]);

  function generate(withNumber: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await generatePairing(withNumber ? CLINIC_PHONE : "");
      if ("error" in res) { setError(res.error); return; }
      if (withNumber && !res.pairingCode && res.state !== "open") {
        setError("A Evolution não gerou o código de pareamento. Tente de novo ou use o QR code.");
      }
      setState(res.state);
      setResult(res.state === "open" ? null : res);
    });
  }

  const color = state === "open" ? OK : BAD;
  const btn: React.CSSProperties = {
    background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12,
    padding: "10px 16px", fontWeight: 700, fontSize: 14, cursor: pending ? "wait" : "pointer",
    opacity: pending ? 0.7 : 1,
  };
  const ghost: React.CSSProperties = {
    ...btn, background: "transparent", color: "var(--txt)", border: "1px solid var(--line)",
  };

  return (
    <section className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16, borderLeft: `4px solid ${color}` }}>
      <div>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>WhatsApp da clínica</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          Se o WhatsApp desconectar do sistema, gere um QR code ou um código de pareamento e conecte pelo celular da clínica.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          Status: <span style={{ color }}>{LABEL[state]}</span>
        </span>
        <button type="button" onClick={() => startTransition(refresh)} disabled={pending} style={ghost}>
          Verificar de novo
        </button>
      </div>

      {state !== "open" && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" onClick={() => generate(false)} disabled={pending} style={btn}>
              {pending ? "Gerando…" : "Gerar QR code"}
            </button>
            <span className="muted" style={{ fontSize: 13 }}>ou</span>
            <button type="button" onClick={() => generate(true)} disabled={pending} style={ghost}>
              Gerar código de pareamento ({CLINIC_PHONE})
            </button>
          </div>

          {result?.pairingCode && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, fontFamily: "ui-monospace, monospace" }}>
                {result.pairingCode.length === 8 ? `${result.pairingCode.slice(0, 4)}-${result.pairingCode.slice(4)}` : result.pairingCode}
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone, e digite o código.
              </span>
            </div>
          )}

          {result?.qr && !result.pairingCode && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- data: URL from Evolution */}
              <img src={result.qr} alt="QR code para conectar o WhatsApp" width={240} height={240} style={{ background: "#fff", borderRadius: 12, padding: 8 }} />
              <span className="muted" style={{ fontSize: 12.5 }}>
                No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo, e aponte para o QR code.
              </span>
            </div>
          )}

          {waiting && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              O código vale por cerca de 1 minuto. Se expirar, gere outro.
            </span>
          )}
        </>
      )}

      {error && <span role="alert" style={{ fontSize: 13, color: BAD }}>{error}</span>}
    </section>
  );
}
