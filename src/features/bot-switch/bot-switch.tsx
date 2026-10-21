"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setBotEnabled } from "./actions";

const ON = "#6bbf73";
const OFF = "#e2875a";

/**
 * One switch for the whole bot. Turning it OFF asks first — it silences every
 * conversation at once — while turning it back ON is immediate.
 */
export function BotSwitch({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip() {
    const next = !on;
    if (!next && !window.confirm("Desligar o bot? Ele para de responder todo mundo até você ligar de novo. As confirmações de consulta continuam saindo.")) return;
    setError(null);
    setOn(next);
    startTransition(async () => {
      const res = await setBotEnabled(next);
      if ("error" in res) { setOn(!next); setError(res.error); return; }
      router.refresh();
    });
  }

  const color = on ? ON : OFF;
  return (
    <div
      className="card"
      style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", borderLeft: `4px solid ${color}` }}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? "Bot ligado. Clique para desligar." : "Bot desligado. Clique para ligar."}
        onClick={flip}
        disabled={pending}
        style={{
          width: 54, height: 30, borderRadius: 99, border: "none", padding: 3, flexShrink: 0,
          background: color, cursor: pending ? "wait" : "pointer", opacity: pending ? 0.7 : 1,
          display: "flex", justifyContent: on ? "flex-end" : "flex-start", transition: "background .15s",
        }}
      >
        <span style={{ width: 24, height: 24, borderRadius: 99, background: "#fff", display: "block" }} />
      </button>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <strong style={{ fontSize: 15.5 }}>{on ? "Bot ligado" : "Bot desligado"}</strong>
        <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
          {on
            ? "Respondendo as leads do formulário e de quem chama pelo anúncio de WhatsApp."
            : "Ninguém recebe mensagem do bot. Só as confirmações de consulta continuam saindo."}
        </span>
        {error && <span role="alert" style={{ fontSize: 12.5, color: OFF }}>{error}</span>}
      </div>
    </div>
  );
}
