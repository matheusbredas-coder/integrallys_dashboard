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
