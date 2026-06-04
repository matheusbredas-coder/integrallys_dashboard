"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <form action={action} className="card" style={{ padding: 36, width: 360 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
          Integra<span className="gold-text">llys</span>
        </h1>
        <p className="muted" style={{ fontSize: 13, marginBottom: 24 }}>Sign in to your dashboard</p>
        <input name="email" type="email" placeholder="Email" required
          style={{ width: "100%", padding: 12, marginBottom: 10, borderRadius: 12,
                   background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)" }} />
        <input name="password" type="password" placeholder="Password" required
          style={{ width: "100%", padding: 12, marginBottom: 16, borderRadius: 12,
                   background: "var(--panel-hi)", border: "1px solid var(--line)", color: "var(--txt)" }} />
        {state?.error && <p style={{ color: "#e06f6f", fontSize: 13, marginBottom: 12 }}>{state.error}</p>}
        <button type="submit" disabled={pending}
          style={{ width: "100%", padding: 13, borderRadius: 12, border: "none", fontWeight: 700,
                   background: "var(--gold)", color: "#0a0a0b", cursor: "pointer" }}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
