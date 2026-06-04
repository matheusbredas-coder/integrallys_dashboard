# Integrallys CRM — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Next.js app with the premium gold/matte theme, Supabase auth with protected routes, and the normalized SQL data layer — producing a deployable, logged-in app shell.

**Architecture:** Next.js (App Router, TypeScript) on Vercel. Secrets stay server-side. Supabase provides Postgres + Auth. A normalized `clientes_view` and helper views give the rest of the app clean, typed data. A read-only Postgres role is provisioned now for the later chat feature.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Tailwind CSS v4, `@supabase/ssr`, `@supabase/supabase-js`, Vitest, `pg`.

---

## Prerequisites (gather before Task 1)

The implementer needs these values (ask the user, store in `.env.local`):

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service-role key (server only)
- Supabase **direct Postgres connection** access (Project Settings → Database) to run SQL migrations and create the read-only role.
- Node.js 20+ and npm installed (`node -v`).

> If the user hasn't created Supabase Auth users yet, we create one in Task 9's verification.

---

## File Structure

```
package.json, tsconfig.json, next.config.ts        ← scaffold
vitest.config.ts                                   ← test runner
.env.local.example                                 ← documented env vars
src/app/globals.css                                ← theme tokens (gold/matte CSS vars)
src/app/layout.tsx                                 ← root layout, font
src/app/(auth)/login/page.tsx                      ← login form
src/app/(auth)/login/actions.ts                    ← sign-in server action
src/app/(app)/layout.tsx                           ← protected shell (sidebar + main)
src/app/(app)/page.tsx                             ← Overview placeholder
src/app/(app)/patients/page.tsx                    ← Patients placeholder
src/app/(app)/marketing/page.tsx                   ← Marketing "soon" placeholder
src/app/(app)/settings/page.tsx                    ← Settings placeholder
src/components/sidebar.tsx                          ← full-height gold sidebar
src/lib/format.ts                                  ← BRL/number/date formatters (TDD'd)
src/lib/format.test.ts                             ← unit tests
src/lib/supabase/server.ts                         ← server client (service role + auth)
src/lib/supabase/browser.ts                        ← browser client (anon)
src/middleware.ts                                  ← route protection + session refresh
db/migrations/001_clientes_view.sql                ← normalized view
db/migrations/002_procedimentos_expanded.sql       ← procedure unnest view
db/migrations/003_app_settings.sql                 ← settings table + seed
db/migrations/004_metric_snapshots.sql             ← snapshot table
db/migrations/005_readonly_role.sql                ← read-only role + grants
```

---

## Task 1: Scaffold the Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `.gitignore`

- [ ] **Step 1: Create the app in the current directory**

The project must live in this existing folder. Scaffold into a temp dir, then move files in (create-next-app refuses a non-empty dir).

Run:
```bash
cd "/Users/matheusbredapolezi/Developer/Supabase Vendas Upsert"
npx create-next-app@latest .crm-tmp --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack --use-npm
shopt -s dotglob
mv .crm-tmp/* .crm-tmp/.[!.]* . 2>/dev/null
rmdir .crm-tmp
```
Expected: `package.json`, `src/app/`, `tailwind`/`postcss` config present. The existing `sql/`, `n8n/`, `docs/`, `README.md` are untouched.

- [ ] **Step 2: Initialize git and make the first commit**

This folder is not yet a git repo. Run:
```bash
git init
git add -A
git commit -m "chore: scaffold Next.js app (Plan 1)"
```
Expected: a commit is created. (`create-next-app` may have already run `git init`; if so `git init` is a no-op.)

- [ ] **Step 3: Verify the dev server boots**

Run:
```bash
npm run dev &
sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 && kill %1
```
Expected: `200`.

---

## Task 2: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime + dev deps**

Run:
```bash
npm install @supabase/ssr @supabase/supabase-js @anthropic-ai/sdk pg recharts
npm install -D vitest @vitejs/plugin-react jsdom @types/pg
```
Expected: installs succeed, `package.json` lists them.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supabase, anthropic, recharts, pg, vitest"
```

---

## Task 3: Test runner (Vitest)

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", globals: true },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

- [ ] **Step 2: Add the test script**

In `package.json` `"scripts"`, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Verify the runner works (no tests yet)**

Run: `npm test`
Expected: Vitest runs and reports "No test files found" (exit 0 or a clean "no tests" message). This confirms the harness is wired.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts package.json
git commit -m "chore: configure vitest"
```

---

## Task 4: Formatting helpers (TDD)

These pure functions are used by every page (currency, counts, dates), so we build them test-first.

**Files:**
- Create: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/lib/format.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { formatBRL, formatInt, parseGestekDate, formatDate } from "./format";

describe("formatBRL", () => {
  it("formats a number as Brazilian Real", () => {
    expect(formatBRL(2500)).toBe("R$ 2.500,00");
  });
  it("handles null/empty as a dash", () => {
    expect(formatBRL(null)).toBe("—");
    expect(formatBRL("")).toBe("—");
  });
  it("parses numeric strings", () => {
    expect(formatBRL("2500.5")).toBe("R$ 2.500,50");
  });
});

describe("formatInt", () => {
  it("formats thousands", () => {
    expect(formatInt(1204)).toBe("1.204");
  });
  it("handles null", () => {
    expect(formatInt(null)).toBe("—");
  });
});

describe("parseGestekDate", () => {
  it("parses DD/MM/YY HH:MM into a Date", () => {
    const d = parseGestekDate("03/06/26 14:30");
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(5); // June (0-indexed)
    expect(d?.getDate()).toBe(3);
  });
  it("returns null for blanks", () => {
    expect(parseGestekDate("")).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats a Date as DD/MM/YYYY", () => {
    expect(formatDate(new Date(2026, 5, 3))).toBe("03/06/2026");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — `format.ts` has no such exports.

- [ ] **Step 3: Implement `src/lib/format.ts`**

```ts
function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function formatBRL(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : brl.format(n);
}

export function formatInt(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : int.format(n);
}

export function parseGestekDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  return new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
}

export function formatDate(d: Date | null): string {
  if (!d) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test`
Expected: PASS (all format tests green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add BRL/int/date formatting helpers (TDD)"
```

---

## Task 5: Theme tokens (gold / matte black)

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace `src/app/globals.css` with the theme**

```css
@import "tailwindcss";

:root {
  --bg: #0a0a0b;
  --panel-from: #1a1a1e;
  --panel-to: #0e0e10;
  --panel-hi: #1b1b1f;
  --line: #26262b;
  --txt: #f5f5f6;
  --muted: #8c8c95;
  --muted2: #5f5f68;
  --gold: #d9b24c;
  --gold-soft: #f0d488;
  --gold-deep: #9a7b2e;
}

html, body {
  background:
    radial-gradient(900px 500px at 78% -8%, rgba(217,178,76,.06), transparent 60%),
    var(--bg);
  color: var(--txt);
  font-family: var(--font-jakarta), system-ui, sans-serif;
}

/* Reusable premium primitives */
.card {
  background: linear-gradient(155deg, var(--panel-from) 0%, var(--panel-to) 100%);
  border: 1px solid var(--line);
  border-radius: 22px;
  transition: transform .3s, border-color .3s, box-shadow .3s;
}
.card:hover {
  transform: translateY(-4px);
  border-color: rgba(217,178,76,.35);
  box-shadow: 0 18px 50px rgba(0,0,0,.5);
}
.gold-text { color: var(--gold); }
.muted { color: var(--muted); }
```

- [ ] **Step 2: Load Plus Jakarta Sans in `src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = {
  title: "Integrallys CRM",
  description: "Clinic operations dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Verify it renders dark + gold**

Run:
```bash
npm run dev &
sleep 6 && curl -s http://localhost:3000 | grep -q "font-jakarta" && echo "FONT_OK"; kill %1
```
Expected: `FONT_OK` and (visually, in a browser) a matte-black page. UI verification is done via the webapp-testing skill at the end of the plan.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat: premium gold/matte-black theme tokens + Plus Jakarta Sans"
```

---

## Task 6: Environment config + Supabase clients

**Files:**
- Create: `.env.local.example`, `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`
- Modify: `.gitignore` (ensure `.env.local` ignored — create-next-app already does this; verify)

- [ ] **Step 1: Write `.env.local.example`**

```bash
# Browser-safe (used for auth session)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-only
SUPABASE_SERVICE_ROLE_KEY=
# Read-only Postgres role connection string (created in Task 8) — used later by chat
SUPABASE_READONLY_CONNECTION_STRING=

# Server-only (used later by chat + sync)
ANTHROPIC_API_KEY=
N8N_SYNC_WEBHOOK_URL=
```

Then the implementer copies it: `cp .env.local.example .env.local` and fills the values from Prerequisites.

- [ ] **Step 2: Write `src/lib/supabase/browser.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 3: Write `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Auth-aware server client (uses the user's session cookies). */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component (read-only cookies). The middleware
            // refreshes the session cookie instead, so this is safe to ignore.
          }
        },
      },
    }
  );
}

/** Privileged client (service role) for trusted server-side data reads.
 *  Lives in a module that imports next/headers, so it can never be bundled
 *  into a client component. Never import this from a "use client" file. */
export function createSupabaseServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
```

- [ ] **Step 4: Verify `.env.local` is gitignored**

Run: `git check-ignore .env.local && echo IGNORED`
Expected: `IGNORED`.

- [ ] **Step 5: Commit**

```bash
git add .env.local.example src/lib/supabase
git commit -m "feat: env template + supabase server/browser clients"
```

---

## Task 7: SQL data layer — normalized views, settings, snapshots

These run against Supabase via the SQL editor or `psql`. Each migration file is committed; verification runs the query and checks output.

**Files:**
- Create: `db/migrations/001_clientes_view.sql`, `002_procedimentos_expanded.sql`, `003_app_settings.sql`, `004_metric_snapshots.sql`

- [ ] **Step 1: Write `db/migrations/001_clientes_view.sql`**

```sql
-- Normalized, typed view over the TEXT-column Clientes table.
create or replace view public.clientes_view as
select
  c.id,
  c."Nome"               as nome,
  c."Telefone Principal" as telefone,
  c."Email Principal"    as email,
  c."Origem"             as origem,
  c."Procedimentos"      as procedimentos_raw,
  nullif(trim(c."Numero de Vendas"), '')::int        as numero_vendas,
  nullif(trim(c."Receita Total"), '')::numeric       as receita_total,
  nullif(trim(c."Descontos"), '')::numeric           as descontos,
  nullif(trim(c."Ticket Medio"), '')::numeric        as ticket_medio,
  c."Data do Cadastro"   as cadastro_raw,
  to_timestamp(nullif(trim(c."Data do Cadastro"), ''), 'DD/MM/YY HH24:MI') as cadastro_at,
  c.gestek_id
from public."Clientes" c;

grant select on public.clientes_view to anon, authenticated, service_role;
```

- [ ] **Step 2: Write `db/migrations/002_procedimentos_expanded.sql`**

```sql
-- One row per (patient, procedure, qty), parsed from "Botox (3), Limpeza (2)".
create or replace view public.procedimentos_expanded as
select
  c.id,
  trim(m[1]) as procedure_name,
  (m[2])::int as qty
from public."Clientes" c
cross join lateral
  regexp_matches(coalesce(c."Procedimentos", ''), '([^,()]+?)\s*\((\d+)\)', 'g') as m;

grant select on public.procedimentos_expanded to anon, authenticated, service_role;
```

- [ ] **Step 3: Write `db/migrations/003_app_settings.sql`**

```sql
create table if not exists public.app_settings (
  key   text primary key,
  value numeric not null
);

insert into public.app_settings (key, value) values
  ('monthly_revenue_goal', 65000),
  ('monthly_new_patient_goal', 30),
  ('avg_ticket_goal', 280)
on conflict (key) do nothing;

grant select on public.app_settings to anon, authenticated, service_role;
grant insert, update on public.app_settings to service_role;
```

- [ ] **Step 4: Write `db/migrations/004_metric_snapshots.sql`**

```sql
create table if not exists public.metric_snapshots (
  id            bigint generated always as identity primary key,
  captured_at   timestamptz not null default now(),
  period_month  date not null,                 -- first day of the snapshot month
  total_revenue numeric,
  total_patients int,
  total_sales   int,
  avg_ticket    numeric,
  unique (period_month)
);

grant select on public.metric_snapshots to anon, authenticated, service_role;
grant insert, update on public.metric_snapshots to service_role;
```

- [ ] **Step 5: Apply all four in Supabase**

Run each file in the Supabase SQL editor (or `psql "$DIRECT_CONNECTION" -f db/migrations/00X_*.sql`).

- [ ] **Step 6: Verify the view returns typed data**

In the SQL editor run:
```sql
select count(*) as n,
       sum(receita_total) as revenue,
       sum(numero_vendas) as sales
from public.clientes_view;
```
Expected: `n` ≈ 334, `revenue` and `sales` are numbers (not errors). If a cast fails, a row has unexpected text — inspect with `select id, "Receita Total" from "Clientes" where "Receita Total" !~ '^\s*[0-9.]*\s*$';` and adjust the `nullif/trim` cleanup.

- [ ] **Step 7: Verify procedure parsing**

```sql
select procedure_name, sum(qty) total
from public.procedimentos_expanded
group by 1 order by 2 desc limit 5;
```
Expected: a ranked list like `Limpeza de pele | 212`, etc.

- [ ] **Step 8: Commit**

```bash
git add db/migrations
git commit -m "feat: clientes_view, procedimentos_expanded, app_settings, metric_snapshots"
```

---

## Task 8: Read-only Postgres role (for the future chat executor)

**Files:**
- Create: `db/migrations/005_readonly_role.sql`

- [ ] **Step 1: Write `db/migrations/005_readonly_role.sql`**

```sql
-- Dedicated SELECT-only login role used ONLY to execute AI-generated SQL (Plan 4).
-- Replace <STRONG_PASSWORD> before running; put the same value in the connection string.
do $$
begin
  if not exists (select from pg_roles where rolname = 'crm_readonly') then
    create role crm_readonly login password '<STRONG_PASSWORD>';
  end if;
end $$;

grant usage on schema public to crm_readonly;
grant select on public.clientes_view to crm_readonly;
grant select on public.procedimentos_expanded to crm_readonly;
-- Intentionally NOT granting on base tables or settings/snapshots.

alter role crm_readonly set statement_timeout = '5s';
alter role crm_readonly set default_transaction_read_only = on;
```

- [ ] **Step 2: Apply it and set the connection string**

Run the file in Supabase (replace `<STRONG_PASSWORD>`). Then build the connection string from Project Settings → Database (host, port 5432/6543, dbname `postgres`, user `crm_readonly`) and put it in `.env.local` as `SUPABASE_READONLY_CONNECTION_STRING`.

- [ ] **Step 3: Verify the role is read-only**

Using the read-only connection string:
```bash
psql "$SUPABASE_READONLY_CONNECTION_STRING" -c "select count(*) from clientes_view;"   # expect a number
psql "$SUPABASE_READONLY_CONNECTION_STRING" -c "update app_settings set value=1;"        # expect: permission denied / read-only
```
Expected: the SELECT works; the UPDATE is **rejected**.

- [ ] **Step 4: Commit**

```bash
git add db/migrations/005_readonly_role.sql
git commit -m "feat: read-only crm_readonly role + grants"
```

---

## Task 9: Auth — login page, server action, middleware

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/actions.ts`, `src/middleware.ts`

- [ ] **Step 1: Write the sign-in action `src/app/(auth)/login/actions.ts`**

```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signIn(_prev: unknown, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  redirect("/");
}
```

- [ ] **Step 2: Write the login page `src/app/(auth)/login/page.tsx`**

```tsx
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
```

- [ ] **Step 3: Write `src/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isLogin = request.nextUrl.pathname.startsWith("/login");

  if (!user && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (user && isLogin) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
```

- [ ] **Step 4: Create a test user in Supabase**

In Supabase → Authentication → Users → "Add user", create an email+password user (or run the verification below after the shell exists). Disable email confirmation for internal use (Authentication → Providers → Email).

- [ ] **Step 5: Verify protection redirects**

Run:
```bash
npm run dev &
sleep 6
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/   # expect 307 -> /login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/login              # expect 200
kill %1
```
Expected: `/` redirects (307) to `/login`; `/login` returns 200.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(auth)" src/middleware.ts
git commit -m "feat: supabase auth login + route-protection middleware"
```

---

## Task 10: Protected app shell (sidebar + placeholder pages)

**Files:**
- Create: `src/components/sidebar.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/page.tsx`, `src/app/(app)/patients/page.tsx`, `src/app/(app)/marketing/page.tsx`, `src/app/(app)/settings/page.tsx`
- Delete: `src/app/page.tsx` (replaced by the `(app)` group's index)

- [ ] **Step 1: Remove the scaffold index page**

Run: `rm src/app/page.tsx`
(The Overview lives at `src/app/(app)/page.tsx`.)

- [ ] **Step 2: Write `src/components/sidebar.tsx`**

```tsx
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
```

- [ ] **Step 3: Write the protected layout `src/app/(app)/layout.tsx`**

```tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: "100vh" }}>
      <Sidebar email={user.email ?? "User"} />
      <main style={{ padding: "30px 34px" }}>{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Write the placeholder pages**

`src/app/(app)/page.tsx`:
```tsx
export default function OverviewPage() {
  return <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Overview</h1>;
}
```

`src/app/(app)/patients/page.tsx`:
```tsx
export default function PatientsPage() {
  return <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Patients</h1>;
}
```

`src/app/(app)/marketing/page.tsx`:
```tsx
export default function MarketingPage() {
  return (
    <div>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Marketing</h1>
      <p className="muted" style={{ marginTop: 8 }}>Lead-gen & campaigns — coming soon.</p>
    </div>
  );
}
```

`src/app/(app)/settings/page.tsx`:
```tsx
export default function SettingsPage() {
  return <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.6px" }}>Settings</h1>;
}
```

- [ ] **Step 5: Verify the shell renders for a logged-in user**

Use the webapp-testing skill (Playwright) to: open `http://localhost:3000`, sign in with the test user, confirm redirect to `/`, confirm the gold sidebar shows Overview/Patients/Marketing(soon)/Settings and the user email at the bottom, and that nav links switch pages. Capture a screenshot.

Expected: matte-black shell, gold accents, working navigation.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)" src/components/sidebar.tsx
git commit -m "feat: protected app shell with gold sidebar + placeholder pages"
```

---

## Task 11: Sign-out + final foundation verification

**Files:**
- Modify: `src/components/sidebar.tsx` (add sign-out)
- Create: `src/app/(app)/signout/actions.ts`

- [ ] **Step 1: Write `src/app/(app)/signout/actions.ts`**

```ts
"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Add a sign-out button to the sidebar profile block**

In `src/components/sidebar.tsx`, import the action and wrap the profile block's right side with a small form:
```tsx
import { signOut } from "@/app/(app)/signout/actions";
// ...inside the profile <div>, after the name block:
<form action={signOut} style={{ marginLeft: "auto" }}>
  <button type="submit" title="Sign out"
    style={{ background: "transparent", border: "1px solid var(--line)", color: "var(--muted)",
      borderRadius: 10, padding: "6px 10px", cursor: "pointer", fontSize: 12 }}>
    ⎋
  </button>
</form>
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS (format tests).

- [ ] **Step 4: Lint + build**

Run: `npm run lint && npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 5: Verify sign-out via webapp-testing**

Use Playwright: while logged in, click the sign-out button → expect redirect to `/login`; then visiting `/` redirects back to `/login`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/signout" src/components/sidebar.tsx
git commit -m "feat: sign-out action + button"
```

---

## Self-Review checklist (run before handoff)

- [ ] **Spec coverage:** Foundation covers theme (✓ Task 5), auth/protection (✓ 9), data normalization `clientes_view`/`procedimentos_expanded` (✓ 7), `app_settings` (✓ 7), `metric_snapshots` (✓ 7), read-only role (✓ 8), app shell/sidebar (✓ 10). Overview data, Patients table, Chat, Settings form, Sync, snapshot cron, Vercel deploy are **deferred to Plans 2–5 by design.**
- [ ] **Placeholder scan:** All steps contain real code/commands. The only literal placeholder is `<STRONG_PASSWORD>` / empty env values, which are secrets the user must supply — flagged explicitly.
- [ ] **Type consistency:** `clientes_view` columns (`receita_total`, `numero_vendas`, `cadastro_at`, …) are the names Plans 2–4 will consume. `formatBRL/formatInt/parseGestekDate/formatDate` signatures fixed in Task 4. Supabase client factory names (`createSupabaseServerClient`, `createSupabaseServiceClient`, `createSupabaseBrowserClient`) are consistent across tasks.

---

## What's next

After Plan 1 is green and deployed-ready, I'll write **Plan 2 (Overview)**: a server data API computing KPI aggregates + gauges from `clientes_view`/`procedimentos_expanded`/`app_settings`, then the KPI cards, gauge cards, right rail, and "new patients by month" chart wired to live data.
