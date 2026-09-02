"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/(app)/signout/actions";

/** Chave usada também pelo script inline em (app)/layout.tsx, que aplica o
 *  estado recolhido antes da primeira pintura para o menu não "piscar". */
export const SIDEBAR_STORAGE_KEY = "crm.sidebar.collapsed";

const ITEMS: Array<{ href: string; label: string; icon: React.ReactNode; soon?: boolean }> = [
  { href: "/", label: "Visão Geral", icon: <OverviewIcon /> },
  { href: "/patients", label: "Pacientes", icon: <PatientsIcon /> },
  { href: "/marketing", label: "Marketing", icon: <MarketingIcon /> },
  { href: "/settings", label: "Configurações", icon: <SettingsIcon /> },
];

const Wordmark = () => (
  <span style={{ fontSize: 22, fontWeight: 800 }}>
    Integra<span className="gold-text">llys</span>
  </span>
);

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // O atributo já foi escrito pelo script inline; aqui só sincronizamos o React.
  useEffect(() => {
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      if (next) document.documentElement.dataset.sidebar = "collapsed";
      else delete document.documentElement.dataset.sidebar;
      try {
        localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* navegador sem storage: o menu só não lembra da escolha */
      }
      return next;
    });
  };

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
          borderRight: "1px solid var(--line)",
          display: "flex", flexDirection: "column", minHeight: "100vh",
        }}
      >
        <div className="sidebar-head">
          <span className="sidebar-brand"><Wordmark /></span>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            <span className="sidebar-mark gold-text" aria-hidden>I</span>
            <span className="sidebar-chevron" aria-hidden><ChevronLeftIcon /></span>
          </button>
        </div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {ITEMS.map((it) => {
            const active = path === it.href;
            return (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)}
                title={it.label}
                className={`nav-item${active ? " active" : ""}`}>
                <span className="nav-icon" aria-hidden>{it.icon}</span>
                <span className="nav-label">{it.label}</span>
                {it.soon && <span className="nav-soon" style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700,
                  color: "var(--gold-deep)", textTransform: "uppercase" }}>em breve</span>}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div style={{ width: 40, height: 40, borderRadius: "50%", flex: "none",
            background: "linear-gradient(135deg,#f3d886,#c79a3e)" }} />
          <div className="sidebar-user-info" style={{ minWidth: 0, flex: 1 }}>
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

const ChevronLeftIcon = () => (
  <svg {...iconProps} width={18} height={18} aria-hidden>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const SignOutIcon = () => (
  <svg {...iconProps} width={16} height={16} aria-hidden>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

function OverviewIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function PatientsIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function MarketingIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z" />
      <path d="M17 8.5a4.5 4.5 0 0 1 0 7" /><path d="M20 5.5a8.5 8.5 0 0 1 0 13" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg {...iconProps} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}
