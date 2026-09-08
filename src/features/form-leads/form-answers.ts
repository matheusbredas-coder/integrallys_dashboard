/**
 * The extra questions the Meta form asks — the lead's neighbourhood and how much weight
 * she wants to lose — read back out of `form_leads.raw`.
 *
 * They deliberately have no column of their own. The ingest already keeps every submitted
 * field verbatim in `raw` (see mapSheetFields), so reading them at display time costs no
 * migration, cannot drift from what was actually submitted, and works retroactively on any
 * lead whose raw already carries the answer. Promote them to columns only if something
 * needs to *filter or sort* by them — display alone doesn't justify it.
 *
 * Matching is looser here than in mapping.ts, on purpose. There the labels are short
 * machine names minted by n8n (`full_name`, `phone_number`), so an exact match on the
 * normalized label is exactly right. These two are named after the form's own *question* —
 * a full sentence, in whatever wording the form ends up with — and an exact list would go
 * silently blank the day someone rephrases the question in Ads Manager. So: exact aliases
 * first (pin a known wording and it always wins), then a keyword fallback.
 *
 * Pure, no I/O. See form-answers.test.ts.
 */

import { normalizeHeader } from "./mapping";

/** `form_leads.raw` as stored: the submitted label -> the answer, both verbatim. */
export type RawAnswers = Record<string, string> | null | undefined;

/** Trimmed answer, or null for a blank one — a question left empty is not an answer. */
function clean(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/**
 * First answer whose label matches, exact aliases before patterns.
 *
 * Within each pass the raw object's own order decides, which is submission order — so if a
 * form somehow asks two matching questions, the first one asked wins, the same tie-break
 * mapSheetFields uses for colliding headers.
 */
function findAnswer(raw: RawAnswers, exact: readonly string[], patterns: readonly RegExp[]): string | null {
  if (!raw || typeof raw !== "object") return null;

  const labelled = Object.entries(raw).map(
    ([label, value]) => [normalizeHeader(label), value] as const
  );

  for (const alias of exact) {
    for (const [key, value] of labelled) {
      if (key !== alias) continue;
      const answer = clean(value);
      if (answer !== null) return answer;
    }
  }

  for (const pattern of patterns) {
    for (const [key, value] of labelled) {
      if (!pattern.test(key)) continue;
      const answer = clean(value);
      if (answer !== null) return answer;
    }
  }

  return null;
}

const NEIGHBOURHOOD_EXACT = ["bairro", "qual seu bairro", "em qual bairro voce mora", "neighborhood"] as const;

const NEIGHBOURHOOD_PATTERNS = [/\bbairro\b/, /\bneighborhood\b/] as const;

const WEIGHT_GOAL_EXACT = [
  "quantos quilos voce quer perder",
  "quantos quilos quer perder",
  "quanto peso voce quer perder",
  "quantos quilos deseja perder",
] as const;

/**
 * Ordered most-specific first, and none of them matches on "peso" alone — that is what
 * keeps "Qual seu peso atual?" from being read as the goal. Every pattern demands a verb
 * of losing, or the literal "quantos quilos".
 */
const WEIGHT_GOAL_PATTERNS = [
  /\b(quer|quero|deseja|desejo|gostaria|pretende|pretendo|precisa|preciso)\b.*\b(perder|eliminar|emagrecer)\b/,
  /\b(perder|eliminar|emagrecer)\b.*\b(quilo|quilos|kg|peso)\b/,
  /\bquantos quilos\b/,
  /\bmeta de (peso|emagrecimento)\b/,
] as const;

/** The neighbourhood she said she lives in, or null if the form didn't ask / she skipped it. */
export function leadNeighbourhood(raw: RawAnswers): string | null {
  return findAnswer(raw, NEIGHBOURHOOD_EXACT, NEIGHBOURHOOD_PATTERNS);
}

/** How much weight she wants to lose, verbatim — "10kg", "uns 15 quilos", whatever she typed. */
export function leadWeightGoal(raw: RawAnswers): string | null {
  return findAnswer(raw, WEIGHT_GOAL_EXACT, WEIGHT_GOAL_PATTERNS);
}
