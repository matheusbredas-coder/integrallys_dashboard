# Inline Chat Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the popup-based ChatLauncher with an always-visible inline chat panel placed below the "Receita no período" chart in the overview dashboard.

**Architecture:** A new `ChatPanel` component renders as a card directly in `OverviewDashboard` after `RevenueChart`. It keeps conversation state in React state and syncs to `localStorage` with a daily-expiry key, so messages survive page navigation but reset when the date changes. The streaming fetch logic is unchanged from the existing `ChatLauncher`.

**Tech Stack:** Next.js (App Router), React, TypeScript, `localStorage`, `@testing-library/react`, Vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/features/chat/chat-panel.tsx` | Inline chat UI + localStorage persistence |
| Create | `src/test/chat-panel.test.tsx` | Unit tests for ChatPanel |
| Delete | `src/features/chat/chat-launcher.tsx` | Replaced by ChatPanel |
| Modify | `src/features/overview/overview-dashboard.tsx` | Add `<ChatPanel />` after `<RevenueChart />` |
| Modify | `src/app/(app)/page.tsx` | Remove ChatLauncher import and usage |

---

## Task 1: Create `ChatPanel` component

**Files:**
- Create: `src/features/chat/chat-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
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
    saveMessages(next);
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
```

- [ ] **Step 2: Commit**

```bash
git add src/features/chat/chat-panel.tsx
git commit -m "feat(chat): add inline ChatPanel component with localStorage persistence"
```

---

## Task 2: Write tests for `ChatPanel`

**Files:**
- Create: `src/test/chat-panel.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ChatPanel } from "@/features/chat/chat-panel";

const STORAGE_KEY = "integrallys_chat";
const today = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("renders input and send button", () => {
  render(<ChatPanel />);
  expect(screen.getByPlaceholderText(/pergunte sobre/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /enviar/i })).toBeInTheDocument();
});

test("renders hint text when no messages", () => {
  render(<ChatPanel />);
  expect(screen.getByText(/quanto faturamos/i)).toBeInTheDocument();
});

test("loads persisted messages from localStorage if date matches today", () => {
  const stored = { date: today, messages: [{ role: "user", content: "Olá" }] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  render(<ChatPanel />);
  expect(screen.getByText("Olá")).toBeInTheDocument();
});

test("does not load messages if stored date is not today", () => {
  const stored = { date: "2000-01-01", messages: [{ role: "user", content: "Velho" }] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  render(<ChatPanel />);
  expect(screen.queryByText("Velho")).not.toBeInTheDocument();
});

test("saves messages to localStorage after sending", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("Resposta"));
      controller.close();
    },
  });
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ body: stream });

  render(<ChatPanel />);
  fireEvent.change(screen.getByPlaceholderText(/pergunte sobre/i), { target: { value: "teste" } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));

  await waitFor(() => expect(screen.getByText("Resposta")).toBeInTheDocument());

  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  expect(saved.date).toBe(today);
  expect(saved.messages.some((m: { content: string }) => m.content === "teste")).toBe(true);
});
```

- [ ] **Step 2: Run tests**

```bash
npm test -- chat-panel
```

Expected: all 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/test/chat-panel.test.tsx
git commit -m "test(chat): add ChatPanel unit tests"
```

---

## Task 3: Wire `ChatPanel` into `OverviewDashboard` and clean up

**Files:**
- Modify: `src/features/overview/overview-dashboard.tsx`
- Modify: `src/app/(app)/page.tsx`
- Delete: `src/features/chat/chat-launcher.tsx`

- [ ] **Step 1: Add `ChatPanel` to `OverviewDashboard`**

In `src/features/overview/overview-dashboard.tsx`, add the import at the top:

```tsx
import { ChatPanel } from "@/features/chat/chat-panel";
```

Then in the JSX, insert `<ChatPanel />` after `<RevenueChart data={slice.chart} />`:

```tsx
      <KpiCards kpi={slice.kpi} />
      <Gauges gauges={slice.gauges} />
      <RevenueChart data={slice.chart} />
      <ChatPanel />
      <TopProcedures rows={slice.topProcedures} />
```

- [ ] **Step 2: Remove `ChatLauncher` from `page.tsx`**

In `src/app/(app)/page.tsx`, remove the `ChatLauncher` import line and remove `<ChatLauncher />` from the JSX. The file should look like:

```tsx
import { getOverviewSource } from "@/features/overview/data";
import { RecentSales } from "@/features/overview/recent-sales";
import { OverviewDashboard } from "@/features/overview/overview-dashboard";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const d = await getOverviewSource();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <OverviewDashboard source={d} syncEnabled={process.env.SYNC_ENABLED === "true"} />
      <RecentSales rows={d.recent} />
    </div>
  );
}
```

- [ ] **Step 3: Delete `chat-launcher.tsx`**

```bash
git rm src/features/chat/chat-launcher.tsx
```

- [ ] **Step 4: Run full test suite to confirm nothing broke**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/overview/overview-dashboard.tsx src/app/(app)/page.tsx
git commit -m "feat(overview): embed ChatPanel inline below RevenueChart, remove ChatLauncher"
```
