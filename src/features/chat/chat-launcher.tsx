"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export function ChatLauncher() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [msgs, open]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const next: Msg[] = [...msgs, { role: "user", content: q }, { role: "assistant", content: "" }];
    setMsgs(next);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(0, -1).map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.body) throw new Error("sem stream");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value);
        setMsgs((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
          return copy;
        });
      }
    } catch {
      setMsgs((cur) => { const c = [...cur]; c[c.length - 1] = { role: "assistant", content: "Desculpe — algo deu errado." }; return c; });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div onClick={() => setOpen(true)} role="button"
        style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 16, padding: "15px 20px", color: "var(--muted)", fontSize: 14.5, cursor: "text" }}>
        <span>🔍</span>
        <span>Pergunte qualquer coisa sobre sua clínica — &ldquo;receita deste mês&rdquo;, &ldquo;pacientes que fizeram Botox&rdquo;…</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold-soft)", background: "rgba(217,178,76,.1)", border: "1px solid rgba(217,178,76,.3)", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>IA ✦</span>
      </div>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 50 }} />
          <aside style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "94vw", background: "#0e0e10", borderLeft: "1px solid var(--line)", zIndex: 51, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "18px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>Pergunte à <span className="gold-text">Integrallys</span></div>
              <button onClick={() => setOpen(false)} style={{ background: "transparent", border: "1px solid var(--line)", borderRadius: 10, padding: "6px 10px", color: "var(--muted)", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              {msgs.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Tente: &ldquo;quanto faturamos em maio?&rdquo; · &ldquo;top 5 pacientes por receita&rdquo; · &ldquo;quantos fizeram Botox?&rdquo;</p>}
              {msgs.map((m, i) => (
                <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "85%",
                  background: m.role === "user" ? "var(--gold)" : "var(--panel-hi)", color: m.role === "user" ? "#0a0a0b" : "var(--txt)",
                  border: m.role === "user" ? "none" : "1px solid var(--line)", borderRadius: 14, padding: "10px 14px", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <div style={{ padding: 14, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Pergunte sobre pacientes, vendas, receita…" disabled={busy}
                style={{ flex: 1, padding: "11px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13.5 }} />
              <button onClick={send} disabled={busy} style={{ background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "0 16px", fontWeight: 700, cursor: "pointer" }}>{busy ? "…" : "Enviar"}</button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
