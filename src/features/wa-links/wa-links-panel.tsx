"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buildWaMeUrl, isValidPhone, trackedLinkUrl } from "./link";
import { createWaLink, deleteWaLink } from "./actions";
import type { WaLinkRow } from "./types";

const gold: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
const ghost: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", color: "var(--muted)", fontSize: 13, cursor: "pointer" };
const input: React.CSSProperties = { background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 10, padding: "9px 12px", color: "inherit", fontSize: 13.5, width: "100%" };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".08em", color: "var(--muted)", marginBottom: 6, display: "block" };

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
    } catch { /* clipboard unavailable — ignore */ }
  }
  return { copied, copy };
}

function GeneratorCard({ origin }: { origin: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { copied, copy } = useCopy();

  const phoneOk = isValidPhone(phone);
  const preview = useMemo(() => (phoneOk ? buildWaMeUrl(phone, message) : ""), [phone, message, phoneOk]);

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await createWaLink({ name, phone, message });
      if ("error" in res) { setError(res.error); return; }
      setName(""); setPhone(""); setMessage("");
      router.refresh(); // re-fetch the server component so the new link shows in the list
    });
  }

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={label}>Nome do link</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Bio do Instagram" />
        </div>
        <div>
          <label style={label}>WhatsApp (com DDI+DDD)</label>
          <input style={input} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+55 41 99999-8888" inputMode="tel" />
        </div>
      </div>
      <div>
        <label style={label}>Mensagem inicial</label>
        <textarea style={{ ...input, minHeight: 72, resize: "vertical", fontFamily: "inherit" }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Olá! Vim pelo Instagram e quero saber mais sobre..." />
      </div>

      {preview && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
          <span className="muted">Link wa.me:</span>
          <code style={{ color: "var(--gold-soft)", wordBreak: "break-all" }}>{preview}</code>
          <button style={{ ...ghost, padding: "5px 10px" }} onClick={() => copy("raw", preview)}>{copied === "raw" ? "✓ Copiado" : "Copiar"}</button>
        </div>
      )}

      {error && <div style={{ color: "#e06c6c", fontSize: 12.5 }}>{error}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button style={{ ...gold, opacity: pending || !name.trim() || !phoneOk ? 0.6 : 1 }} disabled={pending || !name.trim() || !phoneOk} onClick={save}>
          {pending ? "Salvando…" : "Salvar e rastrear cliques"}
        </button>
        <span className="muted" style={{ fontSize: 11.5 }}>
          O link rastreável ({origin.replace(/^https?:\/\//, "")}/r/…) conta cada clique. O link wa.me acima é direto, sem rastreamento.
        </span>
      </div>
    </div>
  );
}

function LinkRow({ row, origin }: { row: WaLinkRow; origin: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { copied, copy } = useCopy();
  const tracked = trackedLinkUrl(origin, row.slug);

  function remove() {
    if (!confirm(`Excluir o link "${row.name}"? O histórico de cliques também será removido.`)) return;
    startTransition(async () => {
      await deleteWaLink(row.id);
      router.refresh();
    });
  }

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", opacity: pending ? 0.5 : 1 }}>
      <div style={{ minWidth: 220, flex: 1 }}>
        <div style={{ fontWeight: 600 }}>{row.name}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <code className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>/r/{row.slug}</code>
          <button style={{ ...ghost, padding: "4px 9px", fontSize: 12 }} onClick={() => copy(row.id, tracked)}>{copied === row.id ? "✓ Copiado" : "Copiar link"}</button>
          <a href={tracked} target="_blank" rel="noreferrer" style={{ ...ghost, padding: "4px 9px", fontSize: 12, textDecoration: "none" }}>Testar ↗</a>
        </div>
      </div>
      <div style={{ textAlign: "right", minWidth: 130 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--gold)" }}>{row.click_count}</div>
        <div className="muted" style={{ fontSize: 11 }}>cliques · {row.clicks_24h} hoje · {row.clicks_7d} em 7d</div>
      </div>
      <button style={{ ...ghost, padding: "6px 10px", fontSize: 12 }} disabled={pending} onClick={remove} title="Excluir link">Excluir</button>
    </div>
  );
}

export function WaLinksPanel({ rows }: { rows: WaLinkRow[] }) {
  // Origin is only known in the browser; render tracked URLs after mount to avoid SSR drift.
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const totalClicks = rows.reduce((s, r) => s + (r.click_count ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <GeneratorCard origin={origin} />
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: 16, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="muted" style={{ fontSize: 12 }}>{rows.length} link{rows.length === 1 ? "" : "s"} rastreável{rows.length === 1 ? "" : "is"}</span>
          <span className="muted" style={{ fontSize: 12 }}>{totalClicks} clique{totalClicks === 1 ? "" : "s"} no total</span>
        </div>
        {rows.length === 0 && <div style={{ padding: 18 }}><span className="muted" style={{ fontSize: 13 }}>Nenhum link rastreável ainda. Crie o primeiro acima.</span></div>}
        {rows.map((r) => <LinkRow key={r.id} row={r} origin={origin} />)}
      </div>
    </div>
  );
}
