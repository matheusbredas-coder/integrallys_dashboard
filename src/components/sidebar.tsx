"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { signOut } from "@/app/(app)/signout/actions";

const ITEMS = [
  { href: "/", label: "Visão Geral" },
  { href: "/patients", label: "Pacientes" },
  { href: "/marketing", label: "Marketing", soon: true },
  { href: "/settings", label: "Configurações" },
];

const Wordmark = () => (
  <span style={{ fontSize: 22, fontWeight: 800 }}>
    Integra<span className="gold-text">llys</span>
  </span>
);

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile-only top bar with logo + hamburger (hidden on desktop via CSS) */}
      <header className="mobile-topbar">
        <Wordmark />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Fechar menu" : "Abrir menu"}
          aria-expanded={open}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 44, height: 44, flex: "none", background: "transparent",
            border: "1px solid var(--line)", borderRadius: 12, color: "var(--txt)", cursor: "pointer",
          }}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </header>

      <div
        className={`sidebar-scrim${open ? " open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside
        className={`sidebar${open ? " open" : ""}`}
        style={{
          borderRight: "1px solid var(--line)", padding: "30px 20px",
          display: "flex", flexDirection: "column", minHeight: "100vh",
        }}
      >
        <div style={{ padding: "4px 12px 30px" }}>
          <Wordmark />
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ITEMS.map((it) => {
            const active = path === it.href;
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                  borderRadius: 14, fontWeight: 600, fontSize: 14.5, textDecoration: "none",
                  color: active ? "#fff" : "var(--muted)",
                  background: active ? "linear-gradient(155deg, rgba(217,178,76,.16), rgba(20,20,22,.4))" : "transparent",
                  boxShadow: active ? "inset 0 0 0 1px rgba(217,178,76,.25)" : "none" }}>
                {it.label}
                {it.soon && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700,
                  color: "var(--gold-deep)", textTransform: "uppercase" }}>em breve</span>}
              </Link>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12,
          padding: "14px 12px", borderTop: "1px solid var(--line)" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", flex: "none",
            background: "linear-gradient(135deg,#f3d886,#c79a3e)" }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={email}>{email}</div>
            <div className="muted" style={{ fontSize: 11.5 }}>Administrador</div>
          </div>
          <form action={signOut} style={{ flex: "none" }}>
            <button type="submit" aria-label="Sair" title="Sair"
              style={{ display: "flex", alignItems: "center", justifyContent: "center",
                width: 40, height: 40, background: "transparent", border: "1px solid var(--line)",
                color: "var(--muted)", borderRadius: 10, cursor: "pointer" }}>
              <SignOutIcon />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}

/* Inline stroke icons (consistent 2px stroke, no emoji) */
const iconProps = {
  width: 20, height: 20, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const MenuIcon = () => (
  <svg {...iconProps} aria-hidden><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
);

const CloseIcon = () => (
  <svg {...iconProps} aria-hidden><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
);

const SignOutIcon = () => (
  <svg {...iconProps} width={16} height={16} aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
