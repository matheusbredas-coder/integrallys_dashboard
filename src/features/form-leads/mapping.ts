// Maps a Meta Instant Form submission (label -> answer) onto form_leads columns.
//
// We can't hard-code the labels: Meta names each field after the form's own question,
// which differs per form and per language. So each target column has an alias list,
// matched against a normalized label, and *every* original field is kept in `raw` — a
// question we failed to map is still recoverable.
//
// Two callers, two payload shapes, both funnelled through `coerceIngestFields`:
//   - Ottokit's Facebook Lead Ads trigger — flat ad metadata at the top level, with the
//     lead's actual answers nested in `field_data`.
//   - (historical) a Google Sheet row as a flat header -> cell map under `fields`.
//
// Pure (no I/O) so it stays trivially unit-testable. See mapping.test.ts.

import { normalizePhone } from "@/features/wa-links/link";

export type MappedLead = {
  external_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  campaign: string | null;
  form_name: string | null;
  submitted_at: string | null;
  raw: Record<string, string>;
};

/**
 * Lowercase, strip accents, and reduce punctuation to single spaces, so
 * "Nome Completo", "nome_completo" and "NOME-COMPLETO" all collapse to "nome completo".
 */
export function normalizeHeader(header: string): string {
  return (header ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // drop the combining diacritics NFD just split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Aliases are matched in order, so the most specific comes first. Matching is exact on the
// normalized header (never substring) — otherwise "campaign id" would be taken as the
// campaign name, and "form id" as the form name.
const ALIASES: Record<Exclude<keyof MappedLead, "raw">, string[]> = {
  external_id: ["lead id", "id do lead", "leadid", "id"],
  name: ["full name", "nome completo", "nome e sobrenome", "nome", "name"],
  phone: [
    "phone number",
    "telefone celular",
    "numero de telefone",
    "whatsapp",
    "telefone",
    "celular",
    "phone",
  ],
  email: ["email", "e mail", "endereco de email"],
  campaign: ["campaign name", "nome da campanha", "campanha", "campaign"],
  form_name: ["form name", "nome do formulario", "formulario", "form"],
  submitted_at: [
    "created time",
    "data de envio",
    "data e hora",
    "submitted at",
    "horario de criacao",
    "data",
  ],
};

/** Trimmed value, or null for blank cells — the DB should hold null, not "". */
function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/**
 * Meta writes ISO-8601 (`2026-07-31T14:23:05+0000`), but a sheet reformatted by hand or
 * localized by Sheets can hand back `31/07/2026 14:23`. Try ISO first, then pt-BR.
 * Returns an ISO string for Postgres, or null if it's neither.
 */
export function parseSubmittedAt(value: string | null): string | null {
  if (!value) return null;

  const brMatch = value.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (brMatch) {
    const [, dd, mm, yyyy, hh = "0", mi = "0", ss = "0"] = brMatch;
    const d = new Date(
      Number(yyyy), Number(mm) - 1, Number(dd),
      Number(hh), Number(mi), Number(ss)
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Resolve one target column: walk its aliases in priority order and return the first
 * header present in the row. Driving the loop from the alias list (rather than from the
 * sheet's columns) makes precedence deterministic regardless of column order.
 */
function pick(byNormalized: Map<string, string>, aliases: string[]): string | null {
  for (const alias of aliases) {
    const hit = byNormalized.get(alias);
    if (hit !== undefined) {
      const value = clean(hit);
      if (value !== null) return value;
    }
  }
  return null;
}

/** One `field_data` entry: Meta's Graph shape, or the collapsed form some connectors emit. */
type FieldDatum = { name?: unknown; values?: unknown; value?: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Flatten Meta's `field_data` — `[{ name, values: [...] }, ...]` — into the flat
 * label -> answer map `mapSheetFields` consumes.
 *
 * Tolerant on purpose. Ottokit is the caller and connectors are inconsistent: some pass
 * the array through, some collapse `values` to a single `value`, and some hand the whole
 * thing over as a JSON *string*. Anything unrecognizable yields `{}` rather than throwing,
 * because a malformed field list must not cost us the lead — the ad metadata at the top
 * level still maps, and the raw body is still recorded.
 */
export function flattenFieldData(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};

  let list: unknown = value;
  if (typeof list === "string") {
    const text = list.trim();
    if (text === "") return out;
    try {
      list = JSON.parse(text);
    } catch {
      return out;
    }
  }

  if (!Array.isArray(list)) return out;

  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const { name, values, value: single } = entry as FieldDatum;
    const label = String(name ?? "").trim();
    if (label === "") continue;

    // Checkbox questions carry several answers; join them so one cell holds all of them.
    const text = Array.isArray(values)
      ? values
          .map((v) => (v === null || v === undefined ? "" : String(v).trim()))
          .filter((s) => s !== "")
          .join(", ")
      : single === null || single === undefined
        ? ""
        : String(single);

    // First entry wins on a repeated question name, matching mapSheetFields' stance on
    // colliding headers.
    if (!(label in out)) out[label] = text;
  }

  return out;
}

// Keys that describe the envelope rather than the lead, so they must not land in `raw`.
// `secret` is in here for a stronger reason than tidiness: the ingest route accepts the
// shared secret in the body (see its `isAuthorized`), and `raw` is persisted verbatim —
// without this the credential would be written into the database with every lead.
const RESERVED_BODY_KEYS = new Set(["row", "submitted_at", "fields", "field_data", "secret"]);

/**
 * Pick the field map out of an ingest body, whichever shape it arrived in.
 *
 * An explicit `fields` object is honoured verbatim — that's the original nested contract.
 * Otherwise the body is treated as Ottokit's flat Facebook Lead Ads payload: top-level ad
 * metadata (`campaign_name`, `ad_name`, `form_id`, ...) plus `field_data`, whose entries
 * are merged *over* the metadata. The lead's own answers outrank the ad they arrived from,
 * so a form question named `campaign_name` can't be shadowed by the campaign it ran under.
 */
export function coerceIngestFields(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) return {};
  if (isPlainObject(body.fields)) return body.fields;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (RESERVED_BODY_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    // Keep an unexpected nested structure legible in `raw` instead of "[object Object]".
    out[key] = typeof value === "object" ? JSON.stringify(value) : value;
  }

  Object.assign(out, flattenFieldData(body.field_data));
  return out;
}

export function mapSheetFields(fields: Record<string, unknown>): MappedLead {
  const byNormalized = new Map<string, string>();
  const raw: Record<string, string> = {};

  for (const [header, value] of Object.entries(fields ?? {})) {
    const label = String(header ?? "").trim();
    if (label === "") continue;
    const text = value === null || value === undefined ? "" : String(value);
    raw[label] = text; // keep every column verbatim, mapped or not
    // First header wins on a normalization collision, so a later duplicate column
    // (e.g. both "Nome" and "nome") can't silently clobber the first.
    const key = normalizeHeader(label);
    if (key !== "" && !byNormalized.has(key)) byNormalized.set(key, text);
  }

  const phone = pick(byNormalized, ALIASES.phone);

  return {
    external_id: pick(byNormalized, ALIASES.external_id),
    name: pick(byNormalized, ALIASES.name),
    phone: phone ? normalizePhone(phone) || null : null,
    email: pick(byNormalized, ALIASES.email)?.toLowerCase() ?? null,
    campaign: pick(byNormalized, ALIASES.campaign),
    form_name: pick(byNormalized, ALIASES.form_name),
    submitted_at: parseSubmittedAt(pick(byNormalized, ALIASES.submitted_at)),
    raw,
  };
}
