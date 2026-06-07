"use client";
import { useState, useRef, useEffect } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "integrallys_chat";

function loadMessages(): Msg[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { date: string; messages: Msg[] };
    const today = new Date().toISOString().slice(0, 10);
    return parsed.date === today ? parsed.messages : [];
  } catch {
    return [];
  }
}

function saveMessages(msgs: Msg[]) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, messages: msgs }));
  } catch {
    // localStorage unavailable — degrade silently
  }
}

export function ChatPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMsgs(loadMessages());
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

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
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
      setMsgs((cur) => { saveMessages(cur); return cur; });
    } catch {
      setMsgs((cur) => {
        const c = [...cur];
        c[c.length - 1] = { role: "assistant", content: "Desculpe — algo deu errado." };
        saveMessages(c);
        return c;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ fontSize: 14, fontWeight: 700 }}>Pergunte à <span className="gold-text">Integrallys</span></h3>
        <span style={{ fontSize: 11, color: "var(--gold-soft)", background: "rgba(217,178,76,.1)", border: "1px solid rgba(217,178,76,.3)", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>IA ✦</span>
      </div>

      {msgs.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {msgs.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === "user" ? "flex-end" : "flex-start",
              maxWidth: "85%",
              background: m.role === "user" ? "var(--gold)" : "var(--panel-hi)",
              color: m.role === "user" ? "#0a0a0b" : "var(--txt)",
              border: m.role === "user" ? "none" : "1px solid var(--line)",
              borderRadius: 14, padding: "10px 14px", fontSize: 13.5, whiteSpace: "pre-wrap", lineHeight: 1.5,
            }}>
              {m.content || (busy && i === msgs.length - 1 ? "…" : "")}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}

      {msgs.length === 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Tente: &ldquo;quanto faturamos em maio?&rdquo; · &ldquo;top 5 pacientes por receita&rdquo; · &ldquo;quantos fizeram Botox?&rdquo;
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Pergunte sobre pacientes, vendas, receita…"
          disabled={busy}
          style={{ flex: 1, padding: "11px 14px", borderRadius: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)", fontSize: 13.5 }}
        />
        <button
          onClick={send}
          disabled={busy}
          style={{ background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "0 16px", fontWeight: 700, cursor: "pointer" }}
        >
          {busy ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
