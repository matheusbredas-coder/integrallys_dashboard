import "server-only";

// The outbox around features/capi/client.ts: record the event first, send it second, and let
// /api/cron/capi mop up whatever didn't land.
//
// The ordering is the whole point. A stage change is a human action nobody repeats — if the
// only send attempt fails and that is the end of it, the signal is gone for good. Committing
// the row first turns a Meta outage into a delay instead of a loss.
//
// The send itself is deferred to `after()` so it lands outside the user's request; only the
// INSERT is on the critical path. See enqueueStageEvent.

import { after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildEvent, isEventTooOld, resolveEventTime, type CapiEvent } from "./event";
import {
  readCapiConfig,
  readLeadEventSource,
  readPurchaseValue,
  sendCapiEvent,
  type CapiConfig,
} from "./client";

/** Source of truth for `capi_events.status` — the column is permissive text by design. */
export const CAPI_EVENT_STATUSES = ["pending", "sent", "failed", "expired"] as const;
export type CapiEventStatus = (typeof CAPI_EVENT_STATUSES)[number];

/** A row of public.capi_events (migration 023), narrowed to what the drain needs. */
type CapiEventRow = {
  id: string;
  event_time: number;
  payload: CapiEvent;
  attempts: number;
};

/** The columns of `form_leads` that feed `user_data` and the event's timestamp. */
type LeadIdentityRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  external_id: string | null;
  /** When the person filled the form — the true event_time of the opening `Lead` event. */
  submitted_at: string | null;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Sending is gated separately from recording, so events accumulate safely while it's off. */
function sendingEnabled(): boolean {
  return process.env.META_CAPI_ENABLED === "true";
}

/**
 * Record the event for a stage change, then deliver it after the response has been sent.
 *
 * The split matters in both directions:
 *
 *   - The INSERT is awaited, so the row is committed before the server action returns. That
 *     is the durability guarantee the outbox exists for — a stage change is a human action
 *     nobody repeats, so the event must survive even if delivery never happens.
 *   - The SEND is handed to `after()` (next/server), so a Meta round trip — up to 8s if their
 *     endpoint is slow — never sits between the user's click and the UI updating. On a
 *     serverless platform a bare floating promise would simply be killed when the action
 *     returns; `after` is what keeps it alive.
 *
 * Never throws and never reports failure upward: the caller's real job is moving the lead,
 * and that has already succeeded by the time we get here. Anything that goes wrong is either
 * retried by the cron or visible in `capi_events`.
 *
 * Returns the outcome for logging only.
 */
export async function enqueueStageEvent(
  formLeadId: string,
  stage: string
): Promise<{ queued: boolean; reason?: string }> {
  try {
    const sb = createSupabaseServiceClient();

    const { data: lead, error: leadError } = await sb
      .from("form_leads")
      .select("id, name, phone, email, external_id, submitted_at")
      .eq("id", formLeadId)
      .maybeSingle<LeadIdentityRow>();

    if (leadError || !lead) {
      return { queued: false, reason: "lead não encontrado" };
    }

    const event = buildEvent({
      identity: {
        leadRowId: lead.id,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        externalId: lead.external_id,
      },
      stage,
      // Not simply "now": the opening Lead event is stamped with when the person actually
      // filled the form, which can be days before the lead reached us. See resolveEventTime.
      nowSeconds: resolveEventTime(stage, lead.submitted_at, nowSeconds()),
      leadEventSource: readLeadEventSource(),
      purchaseValue: readPurchaseValue(),
    });

    // Only reachable if a stage exists in the DB that FORM_LEAD_STAGES doesn't know about.
    if (!event) return { queued: false, reason: "etapa desconhecida" };

    // ignoreDuplicates against capi_events_dedup_key: a lead moved back and forth through the
    // same stage inserts nothing the second time, and `.select()` comes back empty, which is
    // how we know not to send again. Same manoeuvre as the form-lead ingest route.
    const { data: inserted, error: insertError } = await sb
      .from("capi_events")
      .upsert(
        {
          form_lead_id: lead.id,
          event_name: event.event_name,
          event_id: event.event_id,
          event_time: event.event_time,
          payload: event,
          status: "pending" satisfies CapiEventStatus,
        },
        { onConflict: "form_lead_id,event_name", ignoreDuplicates: true }
      )
      .select("id");

    if (insertError) {
      console.error("[capi] failed to record event", insertError);
      return { queued: false, reason: "falha ao gravar o evento" };
    }

    const rowId = inserted?.[0]?.id as string | undefined;
    // Empty `.select()` means the unique index rejected it: this lead already produced this
    // event. A lead dragged qualificado -> contatado -> qualificado lands here, and doing
    // nothing is exactly right.
    if (!rowId) return { queued: false, reason: "evento já registrado" };

    // Recorded. From here on, failing to send only costs a delay — the cron owns the retry.
    if (!sendingEnabled()) return { queued: true, reason: "envio desativado" };

    const config = readCapiConfig();
    if (!config) {
      console.error("[capi] META_CAPI_ENABLED is true but dataset id / token are missing");
      return { queued: true, reason: "não configurado" };
    }

    // Runs after the response is sent, so the user's click doesn't wait on Meta.
    after(async () => {
      try {
        await deliverRow({ id: rowId, event_time: event.event_time, payload: event, attempts: 0 }, config);
      } catch (err) {
        // Can't happen — deliverRow swallows everything — but an unhandled rejection inside
        // `after` would be invisible, so it's caught rather than trusted.
        console.error(`[capi] deferred send failed for event ${rowId}`, err);
      }
    });

    return { queued: true };
  } catch (err) {
    // Belt and braces. Nothing in here is allowed to surface into the stage-change action.
    console.error("[capi] enqueue failed", err);
    return { queued: false, reason: "erro inesperado" };
  }
}

export type DrainResult = {
  ok: boolean;
  processed: number;
  sent: number;
  failed: number;
  expired: number;
  pending: number;
};

/**
 * Send the events that haven't landed yet. Called by /api/cron/capi.
 *
 * Bounded per run (`limit`) so one backlog can't run past the route's maxDuration, and
 * sequential rather than parallel: Meta rate-limits this endpoint, and a burst that trips the
 * limiter would just push the whole batch back to the next run.
 */
export async function drainPendingCapiEvents(limit = 200): Promise<DrainResult> {
  const empty: DrainResult = {
    ok: true, processed: 0, sent: 0, failed: 0, expired: 0, pending: 0,
  };

  const config = readCapiConfig();
  if (!config) {
    console.error("[capi] drain skipped: dataset id / token are missing");
    return { ...empty, ok: false };
  }

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("capi_events")
    .select("id, event_time, payload, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<CapiEventRow[]>();

  if (error) {
    console.error("[capi] drain query failed", error);
    return { ...empty, ok: false };
  }

  const rows = data ?? [];
  const result: DrainResult = { ...empty, processed: rows.length };
  const now = nowSeconds();

  for (const row of rows) {
    // Past Meta's 7-day window this event can never be accepted. Retiring it keeps the
    // backlog from growing without bound and keeps the pending count meaningful.
    if (isEventTooOld(row.event_time, now)) {
      await markRow(row.id, {
        status: "expired",
        error_message: "evento fora da janela de 7 dias da Meta",
      });
      result.expired += 1;
      continue;
    }

    const outcome = await deliverRow(row, config);
    if (outcome === "sent") result.sent += 1;
    else if (outcome === "failed") result.failed += 1;
    else result.pending += 1;
  }

  return result;
}

type Outcome = "sent" | "failed" | "pending";

async function deliverRow(row: CapiEventRow, config: CapiConfig): Promise<Outcome> {
  const result = await sendCapiEvent(row.payload, config);
  const attempts = row.attempts + 1;

  if (result.ok) {
    await markRow(row.id, {
      status: "sent",
      attempts,
      sent_at: new Date().toISOString(),
      fbtrace_id: result.fbtraceId,
      error_code: null,
      error_message: null,
    });
    return "sent";
  }

  // A permanent error stays 'failed' so it stops consuming a retry slot every 15 minutes;
  // a transient one stays 'pending' and gets picked up again next run.
  const status: CapiEventStatus = result.permanent ? "failed" : "pending";
  await markRow(row.id, {
    status,
    attempts,
    error_code: result.code,
    error_message: result.message,
    fbtrace_id: result.fbtraceId,
  });
  return result.permanent ? "failed" : "pending";
}

/** Bookkeeping write. Failures here are logged, never thrown: the send already happened. */
async function markRow(id: string, patch: Record<string, unknown>): Promise<void> {
  const sb = createSupabaseServiceClient();
  const { error } = await sb
    .from("capi_events")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.error(`[capi] failed to update event ${id}`, error);
}
