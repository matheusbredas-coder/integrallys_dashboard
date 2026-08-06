import "server-only";

// Thin wrapper over Meta's Conversions API endpoint. Same stance as lib/slack.ts: it never
// throws. A conversion event is a side effect of a CRM stage change, and a Meta outage must
// never fail the write that triggered it — the caller gets a typed result and the outbox
// decides whether to retry.
//
// The one thing this module is strict about is telling a *transient* failure from a
// *permanent* one. Retrying a bad access token every 15 minutes forever accomplishes nothing
// and buries the real signal; retrying a 503 is exactly right. Getting that classification
// wrong is how a queue quietly rots.

import type { CapiEvent } from "./event";

export type CapiConfig = {
  datasetId: string;
  accessToken: string;
  apiVersion: string;
  testEventCode: string | null;
};

/**
 * Read the CAPI settings from the environment, or null when it isn't configured.
 *
 * Deliberately independent of `META_CAPI_ENABLED`: the queue still *records* events while the
 * integration is switched off, so the code can ship before the Dataset ID and token exist and
 * nothing that happened in between is lost.
 */
export function readCapiConfig(): CapiConfig | null {
  const datasetId = process.env.META_CAPI_DATASET_ID?.trim();
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN?.trim();
  if (!datasetId || !accessToken) return null;

  const testEventCode = process.env.META_CAPI_TEST_EVENT_CODE?.trim();
  return {
    datasetId,
    accessToken,
    apiVersion: process.env.META_CAPI_API_VERSION?.trim() || "v26.0",
    testEventCode: testEventCode ? testEventCode : null,
  };
}

/**
 * The name Meta shows as the origin of these events (`custom_data.lead_event_source`).
 * Their guide asks for "the name of your CRM" — HubSpot, Salesforce and so on. Ours is
 * bespoke, so it gets its own name.
 */
export function readLeadEventSource(): string {
  return process.env.META_CAPI_LEAD_EVENT_SOURCE?.trim() || "Integrallys CRM";
}

/** The average ticket to attach to a `Purchase`, or null when none is configured. */
export function readPurchaseValue(): number | null {
  const raw = process.env.META_CAPI_PURCHASE_VALUE?.trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export type CapiSendResult =
  | { ok: true; eventsReceived: number; fbtraceId: string | null }
  | {
      ok: false;
      /** false = worth retrying later; true = retrying will never help. */
      permanent: boolean;
      code: number | null;
      message: string;
      fbtraceId: string | null;
    };

/**
 * Meta error codes that no amount of retrying will fix. Everything else — including every
 * network failure, timeout and 5xx — is treated as transient, because the safe default for an
 * unrecognized error is to try again rather than to silently drop a conversion.
 *
 *   190 — access token invalid or expired. Needs a human in Events Manager.
 *   100 — malformed request or unknown parameter. Needs a code change.
 *   102 — session/authentication problem. Same class as 190.
 *     2 — "unexpected error", but on this endpoint it reliably means a rejected payload.
 */
const PERMANENT_ERROR_CODES = new Set([2, 100, 102, 190]);

/**
 * Rate limiting. Called out separately from the generic transient case only so the log line
 * says what actually happened; the handling is identical (leave it pending, try next run).
 */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

type GraphError = { message?: unknown; code?: unknown; error_user_msg?: unknown };

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Send one event. Never throws; a thrown error from fetch is folded into a transient result. */
export async function sendCapiEvent(
  event: CapiEvent,
  config: CapiConfig
): Promise<CapiSendResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.datasetId}/events`;

  const body: Record<string, unknown> = {
    data: [event],
    access_token: config.accessToken,
  };
  // Routes the event to the Test Events tab in Events Manager instead of production. Must be
  // unset in production or real conversions stop counting — see docs/meta-capi.md.
  if (config.testEventCode) body.test_event_code = config.testEventCode;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // Meta normally answers well under a second. Cap it so a hung connection can't hold a
      // server action open until the platform timeout.
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
  } catch (err) {
    return {
      ok: false,
      permanent: false, // network failure: always worth another go
      code: null,
      message: err instanceof Error ? err.message : "falha de rede",
      fbtraceId: null,
    };
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    // A body we can't parse is only a problem if the status was bad; a 200 still means Meta
    // took the event.
  }

  // Always captured: `fbtrace_id` is the only handle Meta's support will act on.
  const fbtraceId = asString(payload.fbtrace_id);

  if (res.ok && !payload.error) {
    const received = Number(payload.events_received);
    return {
      ok: true,
      eventsReceived: Number.isFinite(received) ? received : 1,
      fbtraceId,
    };
  }

  const error = (payload.error ?? {}) as GraphError;
  const code = typeof error.code === "number" ? error.code : null;
  const message =
    asString(error.error_user_msg) ?? asString(error.message) ?? `HTTP ${res.status}`;

  // A 5xx is Meta's problem, not ours, regardless of what code it carries.
  const permanent =
    res.status < 500 && code !== null && PERMANENT_ERROR_CODES.has(code);

  if (code !== null && RATE_LIMIT_CODES.has(code)) {
    console.warn(`[capi] rate limited (code ${code}); leaving event pending`);
  }
  if (code === 190) {
    // Loud on purpose: every event stalls until someone regenerates the token.
    console.error("[capi] access token rejected (code 190) — regenerate it in Events Manager");
  }

  return { ok: false, permanent, code, message, fbtraceId };
}
