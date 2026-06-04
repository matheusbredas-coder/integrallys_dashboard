export function AskBar() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--panel-hi)", border: "1px solid var(--line)", borderRadius: 16, padding: "15px 20px", color: "var(--muted)", fontSize: 14.5 }}>
      <span>🔍</span>
      <span>Ask anything about your clinic — &ldquo;revenue this month&rdquo;, &ldquo;patients who did Botox&rdquo;…</span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--gold-soft)", background: "rgba(217,178,76,.1)", border: "1px solid rgba(217,178,76,.3)", padding: "3px 9px", borderRadius: 20, fontWeight: 700 }}>AI ✦</span>
    </div>
  );
}
