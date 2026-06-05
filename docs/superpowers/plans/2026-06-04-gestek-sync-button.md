# Gestek Sync Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Overview-header "Sync Gestek" button that triggers the N8N worker workflow over a new webhook and shows the run summary.

**Architecture:** A server-only `triggerGestekSync()` POSTs to the N8N webhook (`X-Sync-Token` header) and normalizes the `{summary, warnings}` response. An auth-gated `/api/sync` route exposes it. A client button (confirm → spinner → inline result) calls the route. Separately, three nodes (Webhook + Set + Respond) are added to the N8N worker workflow JSON so it can be triggered over HTTP.

**Tech Stack:** Next.js 16 (App Router, route handlers), React 19, TypeScript, Vitest 4 (jsdom, globals), Supabase Auth, N8N.

**Reference (read before coding):** spec at [docs/superpowers/specs/2026-06-04-gestek-sync-button-design.md](../specs/2026-06-04-gestek-sync-button-design.md). Mirror the existing chat feature: [src/app/api/chat/route.ts](../../../src/app/api/chat/route.ts) (auth gate, `runtime`/`maxDuration`) and [src/features/chat/chat-launcher.tsx](../../../src/features/chat/chat-launcher.tsx) (client fetch + inline UI). Test style: [src/lib/sql-guard.test.ts](../../../src/lib/sql-guard.test.ts).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/features/sync/trigger.ts` (create) | `server-only` — `triggerGestekSync()` + `normalizeSyncBody()` + types. No React/Next deps. |
| `src/features/sync/trigger.test.ts` (create) | Vitest unit tests for the above (mocked `fetch`). |
| `src/app/api/sync/route.ts` (create) | Auth-gated `POST` → `triggerGestekSync()` → JSON. `maxDuration = 60`. |
| `src/features/sync/sync-button.tsx` (create) | `"use client"` — confirm/spinner/result button. |
| `src/app/(app)/page.tsx` (modify) | Render `<SyncButton/>` in the header row. |
| `Integrallys - Supabase Vendas Upsert (1).json` (modify) | Add Webhook + Set + Respond nodes. |
| `.env` (modify) | Move mis-pasted token into `N8N_SYNC_TOKEN`; set URL. |
| `.env.local.example` (modify) | Document the two new vars. |

---

## Task 1: Env scaffolding

**Files:**
- Modify: `.env` (gitignored — never commit)
- Modify: `.env.local.example`

> Context: `N8N_SYNC_WEBHOOK_URL` (line 12) currently holds an 18-char value that is actually the **token** (mis-pasted). Move it to `N8N_SYNC_TOKEN` and set the real URL, **without printing either secret**.

- [ ] **Step 1: Move the token and set the URL in `.env` via a script (no secret printed)**

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
node -e '
const fs=require("fs");
let lines=fs.readFileSync(".env","utf8").split("\n");
let token="";
lines=lines.map(l=>{const m=l.match(/^N8N_SYNC_WEBHOOK_URL=(.*)$/);
  if(m){ if(m[1] && !/^https?:\/\//.test(m[1])) token=m[1]; return "N8N_SYNC_WEBHOOK_URL=https://n8n.oversend.com.br/webhook/gestek-sync"; }
  return l;});
if(!lines.some(l=>l.startsWith("N8N_SYNC_TOKEN="))){
  const i=lines.findIndex(l=>l.startsWith("N8N_SYNC_WEBHOOK_URL="));
  lines.splice(i+1,0,"N8N_SYNC_TOKEN="+token);
}
fs.writeFileSync(".env",lines.join("\n"));
console.log("done; token moved:", token.length>0, "token length:", token.length);
'
```
Expected: `done; token moved: true token length: 18`

- [ ] **Step 2: Verify the two vars exist with non-empty values (values hidden)**

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
node -e 'require("dotenv");' 2>/dev/null; node --env-file=.env -e 'console.log("URL set:", (process.env.N8N_SYNC_WEBHOOK_URL||"").startsWith("https://"), "| TOKEN set:", (process.env.N8N_SYNC_TOKEN||"").length>0)'
```
Expected: `URL set: true | TOKEN set: true`

- [ ] **Step 3: Document the vars in `.env.local.example`**

Append these two lines to `.env.local.example` (only if not already present):
```
# N8N Gestek sync webhook (Sync button on Overview)
N8N_SYNC_WEBHOOK_URL=
N8N_SYNC_TOKEN=
```

- [ ] **Step 4: Commit the example (NOT `.env`)**

```bash
git add .env.local.example
git commit -m "chore: document N8N sync env vars in example"
```

---

## Task 2: `triggerGestekSync()` + normalization (TDD)

**Files:**
- Create: `src/features/sync/trigger.ts`
- Test: `src/features/sync/trigger.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/sync/trigger.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { triggerGestekSync, normalizeSyncBody } from "./trigger";

const SAMPLE = {
  summary: { mode: "sync", patients_updated: 271, new_patients_inserted: 0, total_sales_aggregated: 838, completed_at: "2026-06-04T00:00:00Z" },
  warnings: [{ level: "warn", message: "x" }],
};

describe("normalizeSyncBody", () => {
  it("unwraps a {summary, warnings} envelope", () => {
    const r = normalizeSyncBody(SAMPLE);
    expect(r).toEqual({ ok: true, summary: SAMPLE.summary, warnings: SAMPLE.warnings });
  });
  it("treats a bare summary object as the summary", () => {
    const r = normalizeSyncBody(SAMPLE.summary);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.summary).toEqual(SAMPLE.summary); expect(r.warnings).toEqual([]); }
  });
  it("returns null summary for non-object bodies", () => {
    const r = normalizeSyncBody("nope");
    expect(r).toEqual({ ok: true, summary: null, warnings: [] });
  });
});

describe("triggerGestekSync", () => {
  beforeEach(() => { process.env.N8N_SYNC_WEBHOOK_URL = "https://n8n.example/webhook/gestek-sync"; process.env.N8N_SYNC_TOKEN = "tok123"; });
  afterEach(() => { vi.restoreAllMocks(); });

  it("returns not_configured when URL missing", async () => {
    process.env.N8N_SYNC_WEBHOOK_URL = "";
    const r = await triggerGestekSync();
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("returns not_configured when token missing", async () => {
    process.env.N8N_SYNC_TOKEN = "";
    const r = await triggerGestekSync();
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
  });
  it("sends X-Sync-Token header and normalizes a happy response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(SAMPLE), { status: 200, headers: { "Content-Type": "application/json" } }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://n8n.example/webhook/gestek-sync");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "X-Sync-Token": "tok123" });
    expect(r).toMatchObject({ ok: true, summary: SAMPLE.summary });
  });
  it("maps a non-2xx webhook response to webhook_error", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500 }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "webhook_error", status: 500 });
  });
  it("returns ok with null summary when body is not JSON", async () => {
    const fetchMock = vi.fn(async () => new Response("not json", { status: 200 }));
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, summary: null, warnings: [] });
  });
  it("maps a thrown network error to network", async () => {
    const fetchMock = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "network" });
  });
  it("maps an AbortError to timeout", async () => {
    const fetchMock = vi.fn(async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const r = await triggerGestekSync(fetchMock as unknown as typeof fetch);
    expect(r).toMatchObject({ ok: false, code: "timeout" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/features/sync/trigger.test.ts`
Expected: FAIL — `Failed to resolve import "./trigger"`.

- [ ] **Step 3: Write `src/features/sync/trigger.ts`**

```ts
import "server-only";

export type SyncSummary = {
  run_id?: string;
  mode?: string;
  patients_updated?: number;
  new_patients_inserted?: number;
  unmatched_sales?: number;
  duplicate_name_warnings?: number;
  orphan_supabase_patients?: number;
  total_sales_aggregated?: number;
  completed_at?: string;
  [k: string]: unknown;
};

export type SyncWarning = { level?: string; message?: string };

export type SyncResult =
  | { ok: true; summary: SyncSummary | null; warnings: SyncWarning[] }
  | { ok: false; code: "not_configured" | "webhook_error" | "network" | "timeout"; status?: number; message: string };

const TIMEOUT_MS = 55_000;

export function normalizeSyncBody(body: unknown): SyncResult {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const summary = (b.summary && typeof b.summary === "object" ? b.summary : b) as SyncSummary;
    const warnings = Array.isArray(b.warnings) ? (b.warnings as SyncWarning[]) : [];
    return { ok: true, summary, warnings };
  }
  return { ok: true, summary: null, warnings: [] };
}

export async function triggerGestekSync(fetchImpl: typeof fetch = fetch): Promise<SyncResult> {
  const url = process.env.N8N_SYNC_WEBHOOK_URL;
  const token = process.env.N8N_SYNC_TOKEN;
  if (!url || !token) {
    return { ok: false, code: "not_configured", message: "Sync not configured — set N8N_SYNC_WEBHOOK_URL and N8N_SYNC_TOKEN." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sync-Token": token },
      body: "{}",
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") return { ok: false, code: "timeout", message: "Sync timed out." };
    return { ok: false, code: "network", message: e instanceof Error ? e.message : "Network error." };
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, code: "webhook_error", status: res.status, message: text.slice(0, 200) || `Webhook returned ${res.status}.` };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: true, summary: null, warnings: [] };
  }
  return normalizeSyncBody(body);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/features/sync/trigger.test.ts`
Expected: PASS (all in both describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/features/sync/trigger.ts src/features/sync/trigger.test.ts
git commit -m "feat: triggerGestekSync server helper (TDD)"
```

---

## Task 3: `/api/sync` route

**Files:**
- Create: `src/app/api/sync/route.ts`

> No unit test — mirrors the untested `chat/route.ts`; covered by build + Playwright. The auth gate and `createSupabaseServerClient()` usage must match [chat/route.ts](../../../src/app/api/chat/route.ts) exactly.

- [ ] **Step 1: Write the route**

Create `src/app/api/sync/route.ts`:
```ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerGestekSync } from "@/features/sync/trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const result = await triggerGestekSync();
  const status = result.ok ? 200 : result.code === "not_configured" ? 503 : 502;
  return Response.json(result, { status });
}
```

- [ ] **Step 2: Verify it compiles (typecheck via build is in Task 7; quick check now)**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "api/sync" || echo "no sync type errors"`
Expected: `no sync type errors`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sync/route.ts
git commit -m "feat: auth-gated /api/sync route"
```

---

## Task 4: Sync button component

**Files:**
- Create: `src/features/sync/sync-button.tsx`

> Verified via Playwright in Task 7 (no unit test — matches how `chat-launcher.tsx` is covered). Uses the existing CSS vars (`--gold`, `--line`, `--panel-hi`, `--muted`, `--txt`).

- [ ] **Step 1: Write the component**

Create `src/features/sync/sync-button.tsx`:
```tsx
"use client";
import { useState } from "react";
import type { SyncResult, SyncSummary } from "./trigger";

type Phase = "idle" | "confirm" | "syncing" | "done" | "error";

function fmt(n: unknown) { return typeof n === "number" ? n.toLocaleString("pt-BR") : "—"; }

export function SyncButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const [warnings, setWarnings] = useState<number>(0);
  const [showWarnings, setShowWarnings] = useState(false);
  const [warnList, setWarnList] = useState<string[]>([]);
  const [err, setErr] = useState("");

  async function run() {
    setPhase("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json().catch(() => null)) as SyncResult | null;
      if (data && data.ok) {
        setSummary(data.summary);
        setWarnings(data.warnings.length);
        setWarnList(data.warnings.map((w) => w.message ?? "").filter(Boolean));
        setPhase("done");
      } else {
        setErr(
          !data ? "Sync failed."
          : data.ok ? "Sync failed."
          : data.code === "not_configured" ? "Sync not configured yet."
          : data.message || "Sync failed.",
        );
        setPhase("error");
      }
    } catch {
      setErr("Network error.");
      setPhase("error");
    }
  }

  const btn: React.CSSProperties = { background: "var(--gold)", color: "#0a0a0b", border: "none", borderRadius: 12, padding: "10px 16px", fontWeight: 700, fontSize: 13.5, cursor: "pointer" };
  const ghost: React.CSSProperties = { background: "transparent", border: "1px solid var(--line)", borderRadius: 12, padding: "10px 14px", color: "var(--muted)", fontSize: 13.5, cursor: "pointer" };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, minWidth: 220 }}>
      {phase === "idle" && <button style={btn} onClick={() => setPhase("confirm")}>↻ Sync Gestek</button>}

      {phase === "confirm" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>Run sync now? Updates patient data.</span>
          <button style={btn} onClick={run}>Yes, sync</button>
          <button style={ghost} onClick={() => setPhase("idle")}>Cancel</button>
        </div>
      )}

      {phase === "syncing" && <button style={{ ...btn, opacity: 0.7, cursor: "default" }} disabled>Syncing…</button>}

      {phase === "done" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#7bd88f", fontWeight: 700 }}>
            ✓ Synced — {fmt(summary?.patients_updated)} updated, {fmt(summary?.new_patients_inserted)} new,{" "}
            <span style={{ cursor: warnings ? "pointer" : "default", textDecoration: warnings ? "underline" : "none" }} onClick={() => warnings && setShowWarnings((s) => !s)}>{warnings} warnings</span>
          </div>
          {showWarnings && warnList.length > 0 && (
            <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", color: "var(--muted)", maxWidth: 360 }}>
              {warnList.slice(0, 8).map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          )}
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Sync again</button>
        </div>
      )}

      {phase === "error" && (
        <div style={{ textAlign: "right", fontSize: 12.5 }}>
          <div style={{ color: "#e06c6c", fontWeight: 700 }}>✕ {err}</div>
          <button style={{ ...ghost, marginTop: 6, padding: "4px 10px" }} onClick={() => setPhase("idle")}>Try again</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/sync/sync-button.tsx
git commit -m "feat: Sync Gestek button component"
```

---

## Task 5: Wire button into the Overview header

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Add the import and render the button in a header row**

In `src/app/(app)/page.tsx`, add the import after the existing imports:
```tsx
import { SyncButton } from "@/features/sync/sync-button";
```

Replace the existing header block:
```tsx
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Hello, Matheus</h1>
        <p className="muted" style={{ marginTop: 4 }}>Here&apos;s your clinic at a glance.</p>
      </div>
```
with:
```tsx
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Hello, Matheus</h1>
          <p className="muted" style={{ marginTop: 4 }}>Here&apos;s your clinic at a glance.</p>
        </div>
        <SyncButton />
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "feat: mount Sync button in Overview header"
```

---

## Task 6: N8N — add webhook to the worker workflow

**Files:**
- Modify: `Integrallys - Supabase Vendas Upsert (1).json`

> Adds three nodes + three connections. The existing `executeWorkflowTrigger` path is untouched. Node `typeVersion`s match the workflow's existing nodes (Set = 3.4).

- [ ] **Step 1: Run the splice script**

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
node -e '
const fs=require("fs"), crypto=require("crypto");
const F="Integrallys - Supabase Vendas Upsert (1).json";
const w=JSON.parse(fs.readFileSync(F,"utf8"));
const uid=()=>crypto.randomUUID();
const has=n=>w.nodes.some(x=>x.name===n);

if(!has("Sync Webhook")) w.nodes.push({
  parameters:{ httpMethod:"POST", path:"gestek-sync", authentication:"headerAuth", responseMode:"responseNode", options:{} },
  type:"n8n-nodes-base.webhook", typeVersion:2, position:[-560,120], id:uid(), name:"Sync Webhook", webhookId:uid(),
});
if(!has("Sync Params")) w.nodes.push({
  parameters:{ assignments:{ assignments:[
    { id:uid(), name:"trigger", value:"webhook", type:"string" },
    { id:uid(), name:"mode", value:"sync", type:"string" },
  ]}, options:{} },
  type:"n8n-nodes-base.set", typeVersion:3.4, position:[-340,120], id:uid(), name:"Sync Params",
});
if(!has("Respond Summary")) w.nodes.push({
  parameters:{ respondWith:"json", responseBody:"={{ $(\x27Build Run Summary\x27).first().json }}", options:{} },
  type:"n8n-nodes-base.respondToWebhook", typeVersion:1.1, position:[3936,-256], id:uid(), name:"Respond Summary",
});

w.connections=w.connections||{};
const link=(from,to)=>{ w.connections[from]=w.connections[from]||{main:[[]]}; w.connections[from].main[0]=w.connections[from].main[0]||[];
  if(!w.connections[from].main[0].some(c=>c.node===to)) w.connections[from].main[0].push({node:to,type:"main",index:0}); };
link("Sync Webhook","Sync Params");
link("Sync Params","Init Run");
link("Set Summary as Output","Respond Summary");

fs.writeFileSync(F, JSON.stringify(w,null,2));
console.log("nodes now:", w.nodes.length, "| has all 3:", ["Sync Webhook","Sync Params","Respond Summary"].every(has));
'
```
Expected: `nodes now: 26 | has all 3: true`

- [ ] **Step 2: Verify the new wiring**

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
node -e '
const w=require("./Integrallys - Supabase Vendas Upsert (1).json");
const c=w.connections;
const out=n=>(c[n]?.main?.[0]||[]).map(x=>x.node);
console.log("Sync Webhook ->", out("Sync Webhook"));
console.log("Sync Params ->", out("Sync Params"));
console.log("Set Summary as Output ->", out("Set Summary as Output"));
'
```
Expected:
```
Sync Webhook -> [ 'Sync Params' ]
Sync Params -> [ 'Init Run' ]
Set Summary as Output -> [ 'Respond Summary' ]
```

- [ ] **Step 3: Commit**

```bash
git add "Integrallys - Supabase Vendas Upsert (1).json"
git commit -m "feat(n8n): add gestek-sync webhook trigger + respond to worker workflow"
```

> **Manual (user, in N8N) — not part of automated execution:** import the updated workflow JSON, create a **Header Auth** credential (Name `X-Sync-Token`, Value = the token), select it on `Sync Webhook`, **Activate** the workflow. Production URL → `https://n8n.oversend.com.br/webhook/gestek-sync`.

---

## Task 7: Verification

**Files:** none (verification only)

- [ ] **Step 1: Unit tests green**

Run: `npm test`
Expected: all suites pass (existing 30+ plus the new `trigger.test.ts`).

- [ ] **Step 2: Production build clean**

Run: `npm run build`
Expected: build succeeds; `/api/sync` listed as a route; no type errors.

- [ ] **Step 3: Write the Playwright mock-verification script**

Create `/tmp/verify_sync.py`:
```python
import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from playwright.sync_api import sync_playwright

OUT = "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert/.superpowers/verify"
EMAIL, PASSWORD = "matheus@oversend.com.br", "integrallys"
SAMPLE = {"summary": {"mode": "sync", "patients_updated": 271, "new_patients_inserted": 2, "total_sales_aggregated": 838, "completed_at": "2026-06-04T12:00:00Z"},
          "warnings": [{"level": "warn", "message": "Sample warning A"}]}

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.dumps(SAMPLE).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass

srv = HTTPServer(("127.0.0.1", 8899), H)
threading.Thread(target=srv.serve_forever, daemon=True).start()

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    pg = b.new_page(viewport={"width": 1480, "height": 1000})
    errs = []
    pg.on("console", lambda m: errs.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))

    pg.goto("http://localhost:3000/login", wait_until="networkidle")
    pg.fill('input[name="email"]', EMAIL); pg.fill('input[name="password"]', PASSWORD)
    pg.click('button[type="submit"]')
    pg.wait_for_url(lambda u: "/login" not in u, timeout=25000)
    pg.goto("http://localhost:3000/", wait_until="networkidle"); pg.wait_for_timeout(500)

    pg.click('button:has-text("Sync Gestek")')
    pg.click('button:has-text("Yes, sync")')
    pg.wait_for_selector('text=Synced', timeout=20000)
    result = pg.inner_text("main")
    pg.screenshot(path=f"{OUT}/10-sync-result.png")
    srv.shutdown()

    ok = ("271" in result) and ("2 new" in result) and ("1 warnings" in result) and not errs
    print("result snippet:", [l for l in result.split("\n") if "Synced" in l])
    print("console errors:", errs[:5] if errs else "(none)")
    print("VERIFY", "PASS ✅" if ok else "FAIL ❌")
    b.close()
```

- [ ] **Step 4: Run the Playwright verification against a mock webhook**

> Points `N8N_SYNC_WEBHOOK_URL` at the local mock so the real N8N isn't needed. `N8N_SYNC_TOKEN` can be any non-empty value for the mock.

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
N8N_SYNC_WEBHOOK_URL="http://127.0.0.1:8899/webhook/gestek-sync" N8N_SYNC_TOKEN="mock" \
python3 "/Users/matheusbredapolezi/.claude/skills/webapp-testing/scripts/with_server.py" \
  --server "npm run dev" --port 3000 --timeout 90 -- python3 /tmp/verify_sync.py
```
Expected: `VERIFY PASS ✅`, console errors `(none)`, screenshot saved. Run with sandbox disabled (needs network for fonts/Supabase auth).

- [ ] **Step 5: Update HANDOFF.md**

Mark Plan 5 (Sync button) done & verified; note the user's remaining one-time N8N steps (import workflow, create Header Auth credential, activate). Commit:
```bash
git add HANDOFF.md
git commit -m "docs: handoff — Gestek sync button done, N8N activation pending"
```

---

## Self-Review notes

- **Spec coverage:** Part A webhook (Task 6), defensive normalization (Task 2), trigger.ts states incl. timeout/network/not_configured (Task 2), auth-gated route w/ maxDuration (Task 3), confirm→spinner→result button (Task 4), Overview-header placement (Task 5), env incl. mis-pasted-token move (Task 1), TDD + Playwright mock verification (Tasks 2 & 7). All covered.
- **Type consistency:** `SyncResult` / `SyncSummary` / `SyncWarning` defined in Task 2 and consumed unchanged in Tasks 3–4. `triggerGestekSync(fetchImpl?)` signature consistent. Status mapping (200/503/502) consistent between route and tests.
- **No placeholders:** every code/command step is complete.
