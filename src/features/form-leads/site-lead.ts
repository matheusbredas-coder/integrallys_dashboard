/**
 * Leads posted straight from integrallysestetica.com.br: the contact form (`site_form`) and the
 * qualification quiz at /avaliacao (`site_quiz`).
 *
 * The site is static, so whatever it sends is public — there is no secret it could hold (that
 * is why /api/leads/form, behind FORM_LEADS_SECRET, can't be its door). This module is the
 * substitute for a secret: it only lets through the exact shape the site sends, with a real
 * name and phone, and drops everything else. Anything that would steer the row (a Meta lead
 * id, a `fields` map, a `secret`) never gets past the allow-list.
 *
 * Pure, no I/O. See site-lead.test.ts.
 */

import { SITE_QUIZ_SOURCE } from "./mapping";

export const SITE_SOURCES = new Set(["site_form", SITE_QUIZ_SOURCE]);

/** Browsers may only post from the live site. Extra origins (local dev) come from env. */
const SITE_ORIGINS = ["https://integrallysestetica.com.br", "https://www.integrallysestetica.com.br"];

export function allowedOrigin(origin: string | null, extra = process.env.SITE_LEADS_EXTRA_ORIGINS): string | null {
  if (!origin) return null;
  const allowed = [...SITE_ORIGINS, ...(extra ?? "").split(",").map((o) => o.trim()).filter(Boolean)];
  return allowed.includes(origin) ? origin : null;
}

/**
 * Every label the site's `lead.ts` sends, and nothing else. Renaming a label on the site
 * without adding it here drops that answer silently — keep the two in step.
 */
const ALLOWED_KEYS = new Set([
  "source",
  "protocolo",
  "Nome completo",
  "WhatsApp",
  "Nome do formulário",
  "Protocolo de interesse",
  "Mensagem",
  // quiz
  "Qualificação",
  "O que mais incomoda",
  "Regiões",
  "Cidade",
  "Vem toda semana",
  "Investimento por mês",
  "Quando quer começar",
]);

const MAX_VALUE = 1000;
const MAX_NAME = 120;

export type SiteLeadCheck = { ok: true; body: Record<string, string> } | { ok: false; error: string };

export function checkSiteLead(input: unknown, now: Date = new Date()): SiteLeadCheck {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Corpo inválido" };
  }

  const body: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_KEYS.has(key) || typeof value !== "string") continue;
    const text = value.trim();
    if (text !== "") body[key] = text.slice(0, MAX_VALUE);
  }

  if (!SITE_SOURCES.has(body.source ?? "")) return { ok: false, error: "Origem inválida" };

  const name = body["Nome completo"] ?? "";
  if (name.length < 2 || name.length > MAX_NAME) return { ok: false, error: "Nome inválido" };

  // Local "(27) 99999-9999" (10–11 digits) or already with the country code (12–13);
  // mapping.ts adds the 55 later. Anything else isn't a number anyone can call back.
  const digits = (body.WhatsApp ?? "").replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return { ok: false, error: "WhatsApp inválido" };

  // The browser's clock is not trusted for when the lead arrived.
  body.submitted_at = now.toISOString();
  return { ok: true, body };
}
