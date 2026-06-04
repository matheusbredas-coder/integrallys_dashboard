# Integrallys CRM Dashboard — Design Spec

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Author:** Matheus B. + Claude

---

## 1. Summary

Build an internal **CRM / operations dashboard** for the Integrallys clinic on top of the
existing Supabase `Clientes` table (~334 patients synced from Gestek by an N8N pipeline).

Three core capabilities:

1. **Overview page** — a premium "birds-eye" dashboard of the whole operation.
2. **Patients (Database) page** — a schema-flexible table view of the Supabase data.
3. **AI chat** — a natural-language "ask anything about the database" bar powered by
   **text-to-SQL** (not a vector store), so it stays cheap and accurate even as data grows.

A **Marketing / lead-gen** section is stubbed in the navigation for future work but is out of
scope for this build.

## 2. Context (what already exists)

- **Supabase `public."Clientes"`** table. Known columns:
  - `id` (text, PK — equals the Gestek client ID)
  - `Nome` (text)
  - `Data do Cadastro` (text, format `DD/MM/YY HH:MM`, Brazilian local time)
  - `Telefone Principal` (text, nullable)
  - `Email Principal` (text, nullable)
  - `Origem` (text, nullable — lead source)
  - `Procedimentos` (text, e.g. `"Botox (3), Limpeza (2)"`)
  - `Numero de Vendas` (text → integer)
  - `Receita Total` (text → numeric, BRL)
  - `Descontos` (text → numeric, BRL)
  - `Ticket Medio` (text → numeric, BRL)
  - `gestek_id` (text — stable Gestek ObjectId)
- **N8N sync pipeline** keeps the metric columns up to date (backfill + monthly cron +
  webhook). **This pipeline is not modified by this project.**
- The metric columns are stored as **TEXT** by design; the dashboard is responsible for
  parsing/formatting them.

## 3. Goals & non-goals

### Goals
- A premium, fast internal dashboard matching the chosen "Dark Modern Dashboard" Webflow
  template (matte black + gold accent).
- A database page that **automatically adapts to new columns** the user adds later.
- A token-efficient AI chat that answers questions about the data without dumping all rows
  into the model context.
- Simple internal auth (a few clinic staff).

### Non-goals (explicitly out of scope for now)
- **Vector store / RAG** — unnecessary; the user will only add *structured* columns.
  A clean seam is left to add it later if free-text notes ever appear.
- The **Marketing page's real data** (campaigns, ad spend) — nav placeholder only.
- **Multi-role permissions** (admin vs viewer) — single internal role for now.
- **Real-time sync** — Gestek has no webhooks; sync stays on the existing N8N cadence.
- Editing patient data from the dashboard (read-only views this iteration).

## 4. Tech stack

| Concern | Choice |
|---|---|
| Framework | **Next.js (App Router)** + TypeScript |
| Styling | **Tailwind CSS** + **shadcn/ui**, themed with extracted design tokens |
| Charts | **Recharts** |
| Database | existing **Supabase** Postgres |
| Auth | **Supabase Auth** (email/password) |
| AI | **Anthropic Claude API** (tool-use loop) |
| Hosting | **Vercel** |

## 5. Architecture

Three trust zones. **All secrets live server-side; the browser never sees an API key.**

```
Browser (Next.js UI)
  → Next.js server (Route Handlers / Server Actions on Vercel)
      ├── Data API     → Supabase (service role)      → clientes_view / tables
      └── Chat agent   → Claude API  +  read-only SQL  → Supabase (read-only role)
```

- **Browser:** renders the dashboard, table, and chat UI. Holds only the Supabase *anon*
  key (for auth session), never service or AI keys.
- **Next.js server:** holds `ANTHROPIC_API_KEY` and the Supabase **service-role** key.
  Exposes a small internal API for dashboard data and for the chat agent.
- **Supabase:** the `Clientes` table, a normalized **`clientes_view`**, a helper
  `procedimentos_expanded` view, a tiny `app_settings` table, a `metric_snapshots` table,
  and a dedicated **read-only Postgres role** used only to execute AI-generated SQL.

## 6. Data layer (the schema-flexible core)

### 6.1 `clientes_view` (normalized)
A SQL view over `Clientes` that:
- Casts TEXT metrics to real types:
  `"Receita Total"::numeric`, `"Numero de Vendas"::int`, `"Descontos"::numeric`,
  `"Ticket Medio"::numeric` (with safe `NULLIF`/regex cleanup for blanks).
- Parses `Data do Cadastro` (`DD/MM/YY HH:MM`) into a real `timestamp` column
  `cadastro_at` for time-based charts and filters.
- Passes through all descriptive columns (`Nome`, `Origem`, contacts, `gestek_id`) and,
  via `SELECT ... ` maintenance, **any future columns** (see 6.4).

Both the dashboard aggregates and the AI query this view so numbers are correct and fast.

### 6.2 `procedimentos_expanded` (helper view)
Unnests the `Procedimentos` string (`"Botox (3), Limpeza (2)"`) into one row per
(patient, procedure_name, count). Enables:
- Overview "Top procedures" aggregation.
- AI questions like "which patients did Botox?" without string-parsing in the model.

### 6.3 `metric_snapshots` (forward-looking history)
Because historical revenue isn't stored, a small table captures a monthly snapshot of the
key aggregates (total revenue, patients, sales, avg ticket) so **revenue-over-time charts
accumulate going forward**. Written by a **monthly Vercel Cron** job that reads
`clientes_view` and appends one snapshot row. No Gestek backfill required.

### 6.4 Schema introspection (adapts to new columns)
- The **Patients table page** reads column metadata from
  `information_schema.columns` for `Clientes`, and renders every column with
  type-aware formatting (numeric → right-aligned/currency, timestamp → date, text → plain).
- The **AI chat** fetches the same schema (column names + types) on each request and
  includes it in the prompt, so newly added columns are immediately queryable.
- **Result:** adding a structured column in Supabase requires *no frontend code change*.

### 6.5 `app_settings`
Tiny key/value table for the gauge **targets**: monthly revenue goal, new-patient target,
avg-ticket goal. Edited on the Settings page.

## 7. Pages

### 7.1 Overview (`/`)
The approved premium layout (matte black + gold, full-bleed 3-column):
- **Top "Ask" bar** — the primary entry point for the AI chat (replaces the template's
  "Search for stats"). Clicking/﻿typing opens the chat panel.
- **3 KPI cards** — Patients, Revenue (total), Sales. Big numerals, faded gradient, hover lift.
- **4 gauge cards** — Revenue goal, New patients, Returning rate, Avg ticket — each showing
  the metric plus progress toward its goal (goals from `app_settings`).
- **Right rail** — clinic summary list (revenue, patients, procedures, avg ticket) +
  "New patients by month" bar chart (from `cadastro_at`; revenue trend appears once
  `metric_snapshots` has history).
- **Full-height sidebar** — Overview · Patients · Marketing (soon) · Settings, with the
  user profile pinned at the bottom. (Procedure/revenue breakdowns live as sections within
  Overview and Patients, not separate pages, to keep scope tight.)

### 7.2 Patients / Database (`/patients`)
- Schema-introspected, sortable, filterable, paginated, searchable table of `clientes_view`.
- Server-side pagination + search (handles growth well beyond 334 rows).
- Row click → **patient detail drawer** (all fields + parsed procedures).
- **Auto-renders any new column.**

### 7.3 Settings (`/settings`)
- Edit gauge targets (`app_settings`).
- Manual **"Sync Gestek"** button → calls the existing N8N webhook.

### 7.4 Marketing (`/marketing`) — placeholder
Nav item marked "soon"; empty-state page describing future lead-gen content.

## 8. Visual design tokens (from the Webflow template, gold variant)

```
--bg:        #0a0a0b   (matte black, faint gold radial glow top-right)
--panel:     gradient #1a1a1e → #0e0e10   (faded cards)
--line:      #26262b
--txt:       #f5f5f6   --muted: #8c8c95
--gold:      #d9b24c   --gold-soft: #f0d488   --gold-deep: #9a7b2e
font:        Plus Jakarta Sans (400–800)
radius:      22px cards · 14px nav · 30px pills
motion:      .2–.3s ease on background / border / box-shadow; hover translateY(-4px)
```

Tight negative letter-spacing on headings/numerals for a premium feel. Recharts series use
gold gradients.

## 9. Chat agent — text-to-SQL (safe & cheap)

Agentic loop on the server using Claude tool-use:

1. Server builds a system prompt containing the **live schema** (from introspection) +
   guardrails + a few example questions.
2. Claude calls a single tool, `run_sql(query)`.
3. Server **validates** the query before executing:
   - exactly one statement,
   - must be `SELECT` (reject any DDL/DML keywords),
   - inject/force a `LIMIT` cap,
   - apply a **statement timeout**.
4. Execute under a dedicated **read-only Postgres role** (SELECT-only grants on
   `clientes_view` / helper views). Even a malicious query cannot modify data.
5. Return the (small) result set to Claude, which **summarizes in natural language**.
   Optionally render the rows as a small table in the chat.
6. Stream the answer to the UI.

**Why it solves the token problem:** the model sees only the *schema* (tiny) and the
*query result* (tiny), never the 334 full rows. Cost stays flat as patient count grows.

## 10. Auth

- Supabase Auth (email/password). A handful of staff accounts, created manually.
- Next.js **middleware** protects all routes except `/login`.
- Server API routes verify the session before serving data or running chat.

## 11. Deployment

- **Vercel** project linked to the repo.
- Env vars (server-only unless noted):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser, for auth)
  - `SUPABASE_SERVICE_ROLE_KEY` (server)
  - `SUPABASE_READONLY_CONNECTION_STRING` (server — the read-only role, for chat SQL)
  - `ANTHROPIC_API_KEY` (server)
  - `N8N_SYNC_WEBHOOK_URL` (server — for the Sync button)

## 12. Component / unit breakdown

Each unit has one clear responsibility, a defined interface, and is independently testable.

| Unit | Responsibility |
|---|---|
| `theme` | Tailwind config + CSS variables (gold/matte tokens) |
| `lib/supabase` | Server (service-role) + browser (anon) client factories |
| `lib/readonly-db` | Read-only connection + SQL validator/guardrails for chat |
| `db/migrations` | `clientes_view`, `procedimentos_expanded`, `metric_snapshots`, `app_settings`, read-only role |
| `lib/schema` | Introspection helper (columns + types) shared by table + chat |
| `features/overview` | KPI cards, gauge cards (config-driven), right-rail, charts |
| `features/patients` | Dynamic table (sort/filter/paginate/search) + detail drawer |
| `features/settings` | Targets form + Sync button |
| `features/chat` | Ask bar + chat panel UI |
| `app/api/chat` | Claude tool-use loop + `run_sql` executor |
| `app/api/data` | KPI aggregates + paginated patient rows |
| `auth` | Supabase Auth wiring, middleware, login page |

## 13. Future seams (designed-in, not built)
- **Vector store:** if free-text columns (notes) are ever added, add an embeddings table +
  a `search_notes` tool alongside `run_sql`. The chat agent's tool list is the extension point.
- **Marketing data:** the `/marketing` route and a future `campaigns`-type table.
- **Revenue history:** already seeded via `metric_snapshots`.

## 14. Success criteria
- Overview loads with correct live aggregates from `clientes_view`.
- Patients page lists/sorts/filters all patients and **auto-shows a newly added column**
  with no code change.
- Chat answers "revenue this month", "patients who did Botox", "highest-revenue patient"
  correctly, using a single read-only SQL query each, with no full-table dump.
- A non-SELECT or multi-statement AI query is **rejected** before execution.
- Only authenticated users can reach any page or API route.
- Deployed and reachable on Vercel with all secrets server-side.
