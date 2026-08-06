// Builds the Conversions API event body for a form lead that moved to a high-intent stage.
//
// Why this exists at all: Meta already knows a lead filled the Instant Form — it delivered
// that lead. What it cannot see is what happened afterwards, which is exactly the signal that
// distinguishes a good lead from a cheap one. Sending the stage transitions back closes that
// loop, so the campaign can be optimized on leads that qualify, book and buy rather than on
// raw form volume.
//
// Pure (no I/O, no env, no clock of its own) so it stays trivially unit-testable. See
// event.test.ts.

import { buildUserData, type CapiIdentity, type CapiUserData } from "./hash";
import { FORM_LEAD_STAGES, type FormLeadStage } from "@/features/form-leads/types";

/**
 * Every stage of the funnel gets an event.
 *
 * Meta's CRM integration guide is explicit about this: "É preciso ter um gatilho para cada
 * estágio do seu funil, incluindo o estágio inicial do lead." The model is learning the
 * *shape* of the funnel, not just its wins — it needs to see how many leads entered to make
 * sense of how many qualified, and it needs `perdido` to learn what a bad lead looks like.
 * Sending only the three high-intent stages would hand it numerators with no denominator.
 *
 * `Lead`, `Schedule` and `Purchase` are standard events. The `Lead*` names are CUSTOM events:
 * reportable as they are, but a Custom Conversion has to be created in Events Manager
 * pointing at one before a campaign can optimize for it. See docs/meta-capi.md.
 */
export const STAGE_EVENTS: Record<FormLeadStage, string> = {
  novo: "Lead",
  contatado: "LeadContatado",
  // The first stage that reflects the LEAD's behaviour rather than ours, and so the first
  // one that actually discriminates. Worth optimizing for once volume allows.
  respondeu: "LeadRespondeu",
  qualificado: "LeadQualificado",
  agendado: "Schedule",
  ganho: "Purchase",
  perdido: "LeadPerdido",
};

/** The Meta event name for a stage, or null when the stage isn't one the CRM defines. */
export function eventNameForStage(stage: string): string | null {
  return STAGE_EVENTS[stage as FormLeadStage] ?? null;
}

/**
 * Deterministic, NOT random.
 *
 * A fresh UUID per attempt would make every retry look like a separate conversion to Meta,
 * inflating the exact numbers this whole feature exists to make trustworthy. Deriving the id
 * from the lead and the event name instead means a replay is recognized and discarded on
 * their side — the retry becomes free.
 *
 * (The `event_id` is also the Pixel deduplication key, but no browser-side Pixel event
 * corresponds to these: they happen inside the CRM, hours or days after the lead left the ad.
 * Here it is purely a resend guard.)
 */
export function buildEventId(formLeadId: string, eventName: string): string {
  return `${formLeadId}:${eventName}`;
}

/**
 * `custom_data` is where Meta's CRM integration expects its two routing fields. They are not
 * optional decoration: `event_source: "crm"` is what tells Meta this is a CRM lead-stage
 * event rather than a website conversion, and `lead_event_source` names the system it came
 * from. Without them the events land but aren't recognized as a CRM funnel.
 */
export type CapiCustomData = {
  event_source: "crm";
  lead_event_source: string;
  value?: number;
  currency?: string;
};

export type CapiEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "system_generated";
  user_data: CapiUserData;
  custom_data: CapiCustomData;
};

export type BuildEventInput = {
  identity: CapiIdentity;
  stage: string;
  /** Unix seconds. Injected rather than read from the clock so tests stay deterministic. */
  nowSeconds: number;
  /** The name of this CRM, for `lead_event_source`. */
  leadEventSource: string;
  /** Average ticket in BRL, for the `Purchase` event only. Omitted when not configured. */
  purchaseValue?: number | null;
};

/**
 * Build one CAPI event, or null when the stage isn't one we report.
 *
 * `action_source` is always `system_generated`: there is no browser in this flow, so we hold
 * no `fbp`, `fbc`, IP or user-agent. Claiming `website` would require an `event_source_url`
 * and a `client_user_agent` we'd have to invent. The honest value costs us some Event Match
 * Quality — these events match on `lead_id` and the hashed contact fields alone — and that is
 * the correct trade.
 */
export function buildEvent(input: BuildEventInput): CapiEvent | null {
  const eventName = eventNameForStage(input.stage);
  if (!eventName) return null;

  const custom_data: CapiCustomData = {
    event_source: "crm",
    lead_event_source: input.leadEventSource,
  };

  // Purchase carries a value only when an average ticket is configured. A Purchase with no
  // value is still a valid conversion signal; a Purchase with a *made-up* value would quietly
  // corrupt ROAS reporting, which is worse than reporting nothing.
  if (eventName === "Purchase" && typeof input.purchaseValue === "number" && input.purchaseValue > 0) {
    custom_data.value = input.purchaseValue;
    custom_data.currency = "BRL";
  }

  return {
    event_name: eventName,
    event_time: input.nowSeconds,
    event_id: buildEventId(input.identity.leadRowId, eventName),
    action_source: "system_generated",
    user_data: buildUserData(input.identity),
    custom_data,
  };
}

/** The stage a lead is born in — the one whose event_time is not "now". */
export const OPENING_STAGE = FORM_LEAD_STAGES[0];

/**
 * When the event actually happened, in unix seconds.
 *
 * Every stage after the first is a human moving the lead on /marketing, so the moment we're
 * told is the moment it happened: "now" is the truth.
 *
 * The opening `Lead` event is the exception. It records the person filling the form, which
 * can be days before the lead reaches us — the "Lead Nova" email has to arrive, n8n has to
 * poll it, and a batch import can lag further still. Stamping those with "now" would tell
 * Meta the lead converted days later than it did, distorting the time-to-conversion the model
 * reads. `submitted_at` is the real answer whenever we have it.
 *
 * Falls back to `now` when the timestamp is missing, unparseable, or in the future — a clock
 * skew on the sender's side must not produce an event Meta rejects outright.
 */
export function resolveEventTime(
  stage: string,
  submittedAt: string | null | undefined,
  nowSeconds: number
): number {
  if (stage !== OPENING_STAGE || !submittedAt) return nowSeconds;
  const ms = new Date(submittedAt).getTime();
  if (!Number.isFinite(ms)) return nowSeconds;
  const seconds = Math.floor(ms / 1000);
  return seconds > 0 && seconds <= nowSeconds ? seconds : nowSeconds;
}

/**
 * Meta rejects events older than 7 days. An event past that window can never be delivered, so
 * retrying it forever just grows the outbox — the queue uses this to retire it instead.
 */
export const MAX_EVENT_AGE_SECONDS = 7 * 24 * 60 * 60;

export function isEventTooOld(eventTime: number, nowSeconds: number): boolean {
  return nowSeconds - eventTime > MAX_EVENT_AGE_SECONDS;
}
