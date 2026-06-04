# SETUP — Gestek → Supabase Sales Aggregation

Step-by-step guide to build the two N8N workflows and wire them to Supabase.

---

## Prerequisites

- N8N instance running on Hostinger / EasyPanel.
- Supabase project with the existing `public."Clientes"` table:
  ```sql
  create table public."Clientes" (
    id                   text not null primary key,  -- IS the Gestek client ID
    "Nome"               text,
    "Telefone Principal" text,
    "Email Principal"    text,
    "Data do Cadastro"   text,   -- "DD/MM/YY HH:MM" BR format
    "Procedimentos"      text,   -- writeable
    "Numero de Vendas"   text,   -- writeable
    "Receita Total"      text,   -- writeable
    "Origem"             text,
    "Descontos"          text,   -- writeable
    "Ticket Medio"       text    -- writeable
  );
  ```
- Gestek Bearer token.
- API base URL: `https://apipublica.gestek.com.br`.

---

## Step 1 — Supabase setup (3 minutes)

Open the **Supabase SQL Editor** and run both migrations IN ORDER.

### 1.1 — Create sync log table

Paste and run [sql/001_gestek_sync_logs.sql](sql/001_gestek_sync_logs.sql) verbatim.

### 1.2 — Create bulk-update RPC

Paste and run [sql/002_bulk_update_patient_metrics.sql](sql/002_bulk_update_patient_metrics.sql) verbatim. No replacements needed — the table name `public."Clientes"` is hard-coded.

### 1.3 — Smoke-test the RPC

```sql
select public.bulk_update_patient_metrics('[]'::jsonb);  -- returns 0
```

---

## Step 2 — N8N credentials (5 minutes)

Open N8N → **Credentials** → **Add Credential**.

### 2.1 — Gestek Bearer token

- Credential type: **Header Auth**
- Name: `Gestek API - Bearer`
- Header Name: `Authorization`
- Header Value: `Bearer <your-gestek-token>`

### 2.2 — Supabase service role

- Credential type: **Header Auth**
- Name: `Supabase - service role`
- Header Name: `apikey`
- Header Value: `<your-supabase-service-role-key>`

You'll add a second header (`Authorization: Bearer <service-role>`) on each request that needs it (or use a "Generic" credential combining both).

### 2.3 — Sync webhook secret

- Credential type: **Header Auth**
- Name: `Sync Webhook Secret`
- Header Name: `X-Sync-Token`
- Header Value: a long random string, e.g. `openssl rand -hex 32`

Save the token — your dashboard will need it.

---

## Step 3 — Build the shared sub-workflow: `Gestek - Core`

This is the heart of the pipeline. Both Backfill and Sync call it via "Execute Workflow".

### 3.1 — Create the workflow

In N8N → **Workflows** → **+ Add Workflow**. Name it `Gestek - Core`.

### 3.2 — Add nodes in this order

#### Node 1: `When Executed by Another Workflow` (trigger)

- Workflow input schema:
  ```
  trigger: string   ("backfill" | "webhook" | "cron")
  mode:    string   ("backfill" | "sync")
  ```

#### Node 2: `Init Run` — Code node

- Paste the contents of [n8n/code-nodes/00_init_run.js](n8n/code-nodes/00_init_run.js).

#### Node 3: `Insert Sync Log (started)` — HTTP Request

- Method: `POST`
- URL: `https://<your-supabase-ref>.supabase.co/rest/v1/gestek_sync_logs`
- Authentication: Header Auth → `Supabase - service role`
- Send Headers:
  - `Authorization: Bearer <your-service-role-key>`
  - `Content-Type: application/json`
  - `Prefer: return=minimal`
- Body (JSON):
  ```json
  {
    "run_id":     "={{ $('Init Run').first().json.run_id }}",
    "started_at": "={{ $('Init Run').first().json.started_at }}",
    "trigger":    "={{ $('Init Run').first().json.trigger }}",
    "mode":       "={{ $('Init Run').first().json.mode }}"
  }
  ```

#### Node 4: `Fetch Clientes Page` — HTTP Request (paginated)

- Method: `GET`
- URL: `https://apipublica.gestek.com.br/api/clientes`
- Authentication: Header Auth → `Gestek API - Bearer`
- Query Parameters:
  - `Limit` = `100`
- **Pagination** (open the Pagination tab on the HTTP node, available in N8N v1.x):
  - Pagination Mode: **Update a Parameter in Each Request**
  - Parameter Name: `Page`
  - Parameter Value: `={{ $pageCount }}`  ← **type only `{{ $pageCount }}` while in expression mode (fx toggle active)**
  - Complete Expression: `={{ ($response.body.clientes ?? $response.body[0].clientes).length < 100 }}`
  - Limit Pages Fetched: 50 (safety cap)

If your N8N version lacks built-in pagination, see **Alternative pagination pattern** at the end.

#### Node 5: `Build Clientes Map` — Code node

- Paste [n8n/code-nodes/01_build_clientes_map.js](n8n/code-nodes/01_build_clientes_map.js).

#### Node 6: `Read Supabase Patients` — HTTP Request

- Method: `GET`
- URL: `https://<your-supabase-ref>.supabase.co/rest/v1/Clientes?select=id,Nome,Data%20do%20Cadastro`
- Headers: same as Node 3.
- Note: `Clientes` (capitalized, no quotes in URL); column names with spaces are URL-encoded (`Data%20do%20Cadastro`).

#### Node 7: `Split Patients` — Code node

- Paste [n8n/code-nodes/02_split_patients.js](n8n/code-nodes/02_split_patients.js).

#### Node 8: `IF mode === sync` — IF node

- Condition: `{{ $('Init Run').first().json.mode }} === "sync"`

##### True branch — `Insert New Patients` (HTTP Request)
- Run only if there's something to insert. Add a prior IF that checks `{{ $('Split Patients').first().json.newGestekClients.length > 0 }}`.
- Method: `POST`
- URL: `https://<your-supabase-ref>.supabase.co/rest/v1/Clientes`
- Send Headers: + `Prefer: return=minimal`
- Body (JSON):
  ```
  ={{ $('Split Patients').first().json.newGestekClients.map(c => {
        const d = new Date(c.dataCriacao);
        const brt = new Date(d.getTime() - 3 * 60 * 60 * 1000);
        const pad = n => String(n).padStart(2, '0');
        const cadastro = `${pad(brt.getUTCDate())}/${pad(brt.getUTCMonth()+1)}/${pad(brt.getUTCFullYear()%100)} ${pad(brt.getUTCHours())}:${pad(brt.getUTCMinutes())}`;
        return {
          id: c.id,
          Nome: c.nome,
          'Data do Cadastro': cadastro
          // Telefone Principal, Email Principal, Origem left NULL by omission
        };
      }) }}
  ```

##### False branch
- No-op for backfill mode. (The previously-planned "ID backfill" step is removed since `Clientes.id` IS the Gestek ID — nothing to fill in.)

#### Node 9: `Merge` (combine both branches)

- Mode: "Combine", "Pass through (Wait)" so the workflow waits for both branches before continuing.

#### Node 10: `Generate Monthly Windows` — Code node

- Paste [n8n/code-nodes/03_generate_monthly_windows.js](n8n/code-nodes/03_generate_monthly_windows.js).
- This node parses `"Data do Cadastro"` as Brazilian `DD/MM/YY HH:MM` and finds the global minimum.

#### Node 11: `Loop Windows` — Split In Batches

- Batch Size: 1
- Add a **Wait** node (250ms) inside the loop after the HTTP call to be polite to Gestek.

#### Node 12: `Fetch Vendas Page` — HTTP Request (paginated, inside loop)

- Method: `GET`
- URL: `https://apipublica.gestek.com.br/api/vendas`
- Authentication: Header Auth → `Gestek API - Bearer`
- Query:
  - `DataInicio` = `={{ $json.start }}`
  - `DataFim`    = `={{ $json.end }}`
  - `Status`     = `1`
  - `Limit`      = `100`
- **Pagination** (same pattern as Node 4):
  - Parameter Name: `Page`
  - Parameter Value: `={{ $pageCount }}`  ← **type only `{{ $pageCount }}` while in expression mode (fx toggle active)**
  - Complete Expression: `={{ $response.body.vendas.length < 100 }}`
  - Limit Pages Fetched: 50

#### Node 13: `Aggregate Sales` — Code node (after the SplitInBatches "done" output)

- Paste [n8n/code-nodes/04_aggregate_sales.js](n8n/code-nodes/04_aggregate_sales.js).

#### Node 14: `Build Update Payload` — Code node

- Paste [n8n/code-nodes/05_build_update_payload.js](n8n/code-nodes/05_build_update_payload.js).

#### Node 15: `Bulk Update Supabase` — HTTP Request

- Method: `POST`
- URL: `https://<your-supabase-ref>.supabase.co/rest/v1/rpc/bulk_update_patient_metrics`
- Headers: same as Node 3 (service role).
- Body:
  ```
  ={{ { "payload": $('Build Update Payload').first().json.rpcPayload } }}
  ```

#### Node 16: `Build Run Summary` — Code node

- Paste [n8n/code-nodes/06_build_run_summary.js](n8n/code-nodes/06_build_run_summary.js).

#### Node 17: `Update Sync Log (completed)` — HTTP Request

- Method: `PATCH`
- URL: `https://<your-supabase-ref>.supabase.co/rest/v1/gestek_sync_logs?run_id=eq.{{ $('Init Run').first().json.run_id }}`
- Body:
  ```
  ={{ {
        "completed_at": $('Build Run Summary').first().json.completed_at,
        "summary":      $('Build Run Summary').first().json.summary,
        "warnings":     $('Build Run Summary').first().json.warnings
      } }}
  ```

#### Node 18: `Set Summary as Output`

- A **Set** node that outputs `{{ $('Build Run Summary').first().json.summary }}` as the workflow result.

### 3.3 — Workflow settings

- Gear icon → **Execution Order**: `v1` (sequential).
- **Save Manual Executions**: ON.
- **Save Data Successful** + **Save Data Error**: ON.

Save the workflow.

---

## Step 4 — Build `Gestek - Backfill` (one-time trigger)

This is a thin wrapper; run MANUALLY exactly once after Step 1.

1. New Workflow → name `Gestek - Backfill`.
2. **Manual Trigger** node.
3. **Set** node:
   - `trigger` = `backfill`
   - `mode`    = `backfill`
4. **Execute Workflow** node:
   - Workflow to call: `Gestek - Core`
   - Pass `trigger` and `mode` from the Set node.
5. Save.

---

## Step 5 — Build `Gestek - Sync` (recurring)

1. New Workflow → name `Gestek - Sync`.
2. Two trigger nodes:

   ### 5a. Webhook trigger
   - HTTP Method: `POST`
   - Path: `gestek-sync`
   - Authentication: **Header Auth** → `Sync Webhook Secret` (from Step 2.3)
   - Response Mode: **Using 'Respond to Webhook' Node**

   ### 5b. Schedule trigger
   - Trigger Interval: **Custom (Cron)**
   - Expression: `0 3 1 * *` (1st of every month at 03:00 server time)

3. Both triggers → **Set** node:
   - `trigger` = `={{ $('Webhook').isExecuted ? "webhook" : "cron" }}`
   - `mode`    = `sync`

4. **Execute Workflow** node → `Gestek - Core` with `trigger` and `mode`.

5. **Respond to Webhook** node (only on the webhook branch):
   - Response Code: `200`
   - Response Body: `={{ $('Execute Workflow').first().json }}`

6. Save and **Activate** the workflow.

7. Copy the webhook URL:
   ```
   https://<your-n8n-host>/webhook/gestek-sync
   ```

---

## Step 6 — Connect the dashboard "Sync" button

From your dashboard frontend:

```js
async function triggerSync() {
  const res = await fetch('https://<your-n8n-host>/webhook/gestek-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sync-Token': '<the-secret-from-2.3>',
    },
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  const summary = await res.json();
  toast(`Updated ${summary.patients_updated} patients in ${
    Math.round((new Date(summary.completed_at) - new Date(summary.started_at)) / 1000)
  }s`);
}
```

**Do NOT expose the secret in client-side code in production.** Two safer patterns:
- Proxy via your dashboard backend (the backend stores the secret).
- Or call from a Supabase Edge Function that holds the secret.

---

## Step 7 — Run & verify

### 7.1 — Run backfill manually

- Open `Gestek - Backfill` → **Execute Workflow**.
- Takes ~1-3 min depending on history depth.
- Check Supabase:
  ```sql
  select * from gestek_sync_logs order by started_at desc limit 1;
  ```

### 7.2 — Sanity check one patient

Pick a patient and verify manually against Gestek's UI:

```sql
select "Nome", "Procedimentos", "Numero de Vendas",
       "Receita Total", "Descontos", "Ticket Medio"
from public."Clientes"
where "Nome" ilike '%leandro%';
```

### 7.3 — Test the webhook

```bash
N8N_HOST=https://your-n8n.com SYNC_TOKEN=xxx ./scripts/test-webhook.sh
```

### 7.4 — Idempotency test

Run sync twice in a row. Second run should produce:
- `new_patients_inserted = 0`
- Same `Receita Total` per row.

---

## Alternative pagination pattern (older N8N)

```
[Set: Page = 0]
   │
   ▼
[HTTP /api/<endpoint>?Page={{ $json.Page }}&Limit=100]
   │
   ▼
[IF: $response.body[0].<collection>.length < 100]
   ├─── false: [Set: Page = Page + 1] ─→ back to HTTP node (loop edge)
   └─── true:  done
```

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `function bulk_update_patient_metrics does not exist` | Migration 002 not run. Re-run it. |
| `permission denied for table Clientes` | RLS blocking writes. Use service-role key (bypasses RLS), or ensure the RPC has `security definer` (it does in 002). |
| Sync says `orphan_supabase_patients > 0` | Patient exists in Supabase but Gestek doesn't return them in `/api/clientes` (maybe deleted/archived there). Investigate and clean up manually. |
| Sync says `unmatched_sales > 0` | Sale references a `clienteId` not present in `/api/clientes` AND not yet inserted by sync. Rare. |
| `The returned response was identical 5x, so requests got stopped` | The pagination `Page` value was set as `=={{ $pageCount }}` (double `=`). n8n's expression prefix is a single `=`, so a doubled prefix sends the literal string `=0`, `=1`, … to the API. The API can't parse it and returns the same page every time. Fix: open the pagination parameter in the node, enable expression mode (fx icon), and type **only** `{{ $pageCount }}` — no leading `=`. |
| Webhook returns 401 | Missing or wrong `X-Sync-Token` header. |
| Webhook returns 500 | Check N8N execution log — last successful node shows where it broke. |
| `Numero de Vendas` shows literally `"5"` with quotes in dashboard | Column is TEXT — render with `Number(value)` or `parseInt(value, 10)` in your dashboard. |
| Dates after the backfill don't match Gestek UI | `Data do Cadastro` parser assumes UTC-3. If Gestek's UI shows local time in another zone, adjust `parseBRDate` / `formatBRDate` accordingly. |
