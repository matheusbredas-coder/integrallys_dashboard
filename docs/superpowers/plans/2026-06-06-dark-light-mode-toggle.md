# Dark / Light Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dark/light theme toggle to the Settings page that persists in localStorage and applies before first paint.

**Architecture:** A `html[data-theme="light"]` CSS block overrides the existing dark CSS variables. An inline `<script>` in `<head>` reads localStorage before React hydrates (no flash). A `"use client"` pill-toggle component in the Settings page reads/writes localStorage and updates `document.documentElement.dataset.theme`.

**Tech Stack:** Next.js (App Router), CSS custom properties, localStorage, Vitest + jsdom for unit tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/globals.css` | Modify | Add `html[data-theme="light"]` variable overrides |
| `src/app/layout.tsx` | Modify | Add inline `<script>` to `<head>` for flash prevention |
| `src/components/theme-toggle.tsx` | Create | Client component: pill toggle (dark ↔ light), reads/writes localStorage |
| `src/app/(app)/settings/page.tsx` | Modify | Add "Aparência" section importing `ThemeToggle` |
| `src/test/theme-toggle.test.tsx` | Create | Unit tests for `ThemeToggle` |

---

### Task 1: Add light-theme CSS variable overrides

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add the light-theme block to globals.css**

Append after the existing `:root { ... }` block (around line 15):

```css
html[data-theme="light"] {
  --bg: #f4f4f6;
  --panel-from: #ffffff;
  --panel-to: #f0f0f2;
  --panel-hi: #fafafa;
  --line: #e2e2e6;
  --txt: #0a0a0b;
  --muted: #6b6b75;
  --muted2: #9090a0;
}

html[data-theme="light"] body {
  background:
    radial-gradient(900px 500px at 78% -8%, rgba(217,178,76,.07), transparent 60%),
    var(--bg);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): add light-mode CSS variable overrides"
```

---

### Task 2: Add flash-prevention inline script to root layout

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Add `<head>` with inline script**

Replace the existing `RootLayout` return so it includes a `<head>` block:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('theme');if(t==='light')document.documentElement.dataset.theme='light';})();` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

The script is intentionally minified so it executes as fast as possible before any render.

- [ ] **Step 2: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat(theme): add flash-prevention script to root layout"
```

---

### Task 3: Build the ThemeToggle component (test-first)

**Files:**
- Create: `src/components/theme-toggle.tsx`
- Create: `src/test/theme-toggle.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/test/theme-toggle.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/theme-toggle";

// jsdom provides localStorage automatically; reset between tests
beforeEach(() => {
  localStorage.clear();
  delete (document.documentElement.dataset as { theme?: string }).theme;
});

test("renders dark button as active by default", () => {
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: /escuro/i })).toHaveAttribute(
    "data-active",
    "true"
  );
  expect(screen.getByRole("button", { name: /claro/i })).toHaveAttribute(
    "data-active",
    "false"
  );
});

test("renders light button as active when localStorage has theme=light", () => {
  localStorage.setItem("theme", "light");
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: /claro/i })).toHaveAttribute(
    "data-active",
    "true"
  );
});

test("clicking Claro sets data-theme=light and persists to localStorage", () => {
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: /claro/i }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("theme")).toBe("light");
});

test("clicking Escuro removes data-theme and persists to localStorage", () => {
  localStorage.setItem("theme", "light");
  document.documentElement.dataset.theme = "light";
  render(<ThemeToggle />);
  fireEvent.click(screen.getByRole("button", { name: /escuro/i }));
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(localStorage.getItem("theme")).toBe("dark");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert" && npx vitest run src/test/theme-toggle.test.tsx
```

Expected: FAIL with `Cannot find module '@/components/theme-toggle'`

- [ ] **Step 3: Install @testing-library/react if not present**

```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert" && npm ls @testing-library/react 2>/dev/null | grep testing-library || npm install -D @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 4: Create the ThemeToggle component**

Create `src/components/theme-toggle.tsx`:

```tsx
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert" && npx vitest run src/test/theme-toggle.test.tsx
```

Expected: 4 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/theme-toggle.tsx src/test/theme-toggle.test.tsx
git commit -m "feat(theme): add ThemeToggle component with tests"
```

---

### Task 4: Add "Aparência" section to Settings page

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Add the Aparência section**

Replace the contents of `src/app/(app)/settings/page.tsx` with:

```tsx
import { getGoals } from "@/features/settings/data";
import { GoalsForm } from "@/features/settings/goals-form";
import { AttendanceImportForm } from "@/features/attendance/import-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const goals = await getGoals();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 720 }}>
      <header>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Configurações</h1>
        <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
          Defina as metas usadas nos medidores da Visão Geral e importe o relatório de atendimentos.
        </p>
      </header>

      <section className="card" style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Aparência</h2>
          <p className="muted" style={{ fontSize: 13 }}>Escolha entre o tema escuro e o tema claro.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Tema</span>
          <ThemeToggle />
        </div>
      </section>

      <GoalsForm goals={goals} />
      <AttendanceImportForm />
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite to confirm nothing broke**

```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert" && npx vitest run
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/settings/page.tsx
git commit -m "feat(theme): add Aparência section with ThemeToggle to Settings"
```
