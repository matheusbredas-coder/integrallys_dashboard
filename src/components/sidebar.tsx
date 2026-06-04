"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/patients", label: "Patients" },
  { href: "/marketing", label: "Marketing", soon: true },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  return (
    <aside style={{ borderRight: "1px solid var(--line)", padding: "30px 20px",
      display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <div style={{ fontSize: 22, fontWeight: 800, padding: "4px 12px 30px" }}>
        Integra<span className="gold-text">llys</span>
      </div>
      <nav style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ITEMS.map((it) => {
          const active = path === it.href;
          return (
            <Link key={it.href} href={it.href}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px",
                borderRadius: 14, fontWeight: 600, fontSize: 14.5, textDecoration: "none",
                color: active ? "#fff" : "var(--muted)",
                background: active ? "linear-gradient(155deg, rgba(217,178,76,.16), rgba(20,20,22,.4))" : "transparent",
                boxShadow: active ? "inset 0 0 0 1px rgba(217,178,76,.25)" : "none" }}>
              {it.label}
              {it.soon && <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700,
                color: "var(--gold-deep)", textTransform: "uppercase" }}>soon</span>}
            </Link>
          );
        })}
      </nav>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 12,
        padding: "14px 12px", borderTop: "1px solid var(--line)" }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%",
          background: "linear-gradient(135deg,#f3d886,#c79a3e)" }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700 }}>{email}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>Admin</div>
        </div>
      </div>
    </aside>
  );
}
