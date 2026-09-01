import { FORM_LEAD_STAGES, type FormLeadStage } from "./types";

/**
 * Whether the bot may move a lead from `current` to `next`.
 *
 * The bot may only move a lead FORWARD through FORM_LEAD_STAGES, never back.
 * pipeline.ts writes `respondeu` on the lead's first reply without reading her
 * current stage, so without this guard a lead a human qualified at 10:00 was
 * silently knocked back to `respondeu` when she finally answered the bot's
 * WhatsApp at 14:00 — losing the human's decision in the table and leaving the
 * Meta funnel permanently disagreeing with the CRM (the CAPI event survives,
 * since capi_events dedupes on `${leadId}:${eventName}`, so the move can be
 * neither un-sent nor re-sent).
 *
 * `agendado` is the one exception and is always allowed: a booking landing in
 * Gestek is ground truth and has to win even over a `perdido` set by hand.
 * Without that carve-out `perdido` — the LAST index, and therefore "ahead" of
 * everything — would block every future bot write for that lead.
 *
 * A human at /marketing keeps full freedom to move a lead in either direction;
 * this only constrains the bot, which is why POST /api/leads/form/stage calls it
 * and features/form-leads/actions.ts does not.
 */
export function isForwardMove(next: FormLeadStage, current: string): boolean {
  if (next === "agendado") return true;
  // A stage the app doesn't know (a legacy or hand-edited value) has index -1,
  // which makes every known stage "forward" of it. That's the right call: an
  // unknown value carries no ordering, so it must not block the bot.
  const currentIndex = FORM_LEAD_STAGES.indexOf(current as FormLeadStage);
  return FORM_LEAD_STAGES.indexOf(next) > currentIndex;
}
