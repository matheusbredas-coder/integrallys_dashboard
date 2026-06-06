"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

const SunIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx={12} cy={12} r={5} />
    <line x1={12} y1={1} x2={12} y2={3} />
    <line x1={12} y1={21} x2={12} y2={23} />
    <line x1={4.22} y1={4.22} x2={5.64} y2={5.64} />
    <line x1={18.36} y1={18.36} x2={19.78} y2={19.78} />
    <line x1={1} y1={12} x2={3} y2={12} />
    <line x1={21} y1={12} x2={23} y2={12} />
    <line x1={4.22} y1={19.78} x2={5.64} y2={18.36} />
    <line x1={18.36} y1={5.64} x2={19.78} y2={4.22} />
  </svg>
);

const MoonIcon = () => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme");
    if (stored === "light") setTheme("light");
  }, []);

  function applyTheme(next: Theme) {
    setTheme(next);
    localStorage.setItem("theme", next);
    if (next === "light") {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
  }

  const pillBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6,
    padding: "8px 14px", border: "none", cursor: "pointer",
    fontSize: 13, fontWeight: 600, borderRadius: 10,
    transition: "background .15s, color .15s",
  };

  const activeStyle: React.CSSProperties = {
    background: "linear-gradient(155deg, rgba(217,178,76,.22), rgba(217,178,76,.06))",
    color: "var(--gold-soft)",
    boxShadow: "inset 0 0 0 1px rgba(217,178,76,.3)",
  };

  const inactiveStyle: React.CSSProperties = {
    background: "transparent",
    color: "var(--muted)",
  };

  return (
    <div style={{
      display: "inline-flex", borderRadius: 12,
      border: "1px solid var(--line)", overflow: "hidden",
      background: "var(--panel-to)",
    }}>
      <button
        type="button"
        role="button"
        aria-label="Escuro"
        data-active={theme === "dark"}
        onClick={() => applyTheme("dark")}
        style={{ ...pillBase, ...(theme === "dark" ? activeStyle : inactiveStyle) }}
      >
        <MoonIcon /> Escuro
      </button>
      <button
        type="button"
        role="button"
        aria-label="Claro"
        data-active={theme === "light"}
        onClick={() => applyTheme("light")}
        style={{ ...pillBase, ...(theme === "light" ? activeStyle : inactiveStyle) }}
      >
        <SunIcon /> Claro
      </button>
    </div>
  );
}
