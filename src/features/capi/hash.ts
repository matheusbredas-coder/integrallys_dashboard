// Normalization + SHA-256 hashing of the customer information Meta's Conversions API
// matches on (`user_data`).
//
// Meta compares hashes, never plaintext, so *our* normalization has to land on exactly the
// same string theirs does — an unnormalized value doesn't match "less well", it doesn't
// match at all. Every rule here is Meta's, not ours; see docs/meta-capi.md.
//
// Pure (no I/O, no env) so it stays trivially unit-testable. See hash.test.ts.

import { createHash } from "node:crypto";
import { normalizePhone } from "@/features/wa-links/link";

/** Lowercase hex SHA-256, Meta's required digest encoding. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Trim + lowercase. Nothing else: the local part of an address is case-sensitive to
 * everyone except Meta, who lowercases it, so we do too. */
export function normalizeEmail(input: string | null | undefined): string {
  return (input ?? "").trim().toLowerCase();
}

/**
 * Digits only, country code included, no `+` and no leading zeros — Meta's phone rule.
 *
 * `normalizePhone` (wa-links) only strips non-digits, which is right for a wa.me link but
 * not enough here: a lead who typed "(41) 99999-8888" gives us `41999998888`, and hashing
 * that never matches the `5541999998888` Meta holds. So a bare Brazilian number — 10 digits
 * (landline / old mobile) or 11 (mobile with the 9th digit) — gets `55` prefixed.
 *
 * **This assumes Brazilian numbers**, and it has to: an 11-digit `14155550134` is a complete
 * US number and an 11-digit `41999998888` is a country-code-less Brazilian mobile, and
 * nothing in the digits themselves tells them apart. The clinic advertises only in Brazil, so
 * BR is the right guess — but a genuinely foreign lead who omits their country code will be
 * mangled into a `55…` number and simply won't match. That is a miss, not corrupt data.
 *
 * 12+ digits is treated as already carrying a country code (13 is a full BR mobile, 12 a full
 * BR landline), so a foreign number written out in full passes through untouched. Under 10
 * digits isn't a phone number at all: returns "" so `buildUserData` omits the field rather
 * than sending a junk hash.
 */
export function toE164Digits(input: string | null | undefined): string {
  const digits = normalizePhone(input ?? "").replace(/^0+/, "");
  if (digits.length >= 12) return digits;
  if (digits.length >= 10) return `55${digits}`;
  return "";
}

/**
 * Lowercase, accents removed, and everything that isn't a letter or digit dropped.
 *
 * Accent folding is deliberate and matters here: Meta normalizes to the unaccented form, so
 * "Joao" and "João" have to hash identically or half our leads silently stop matching.
 */
export function normalizeName(input: string | null | undefined): string {
  return (input ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // drop the combining diacritics NFD just split off
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Split a full name into first and last. Meta wants them as separate hashed fields, but the
 * Instant Form only ever gives us one "Nome completo" answer.
 *
 * First token is `fn`, last token is `ln`; middle names are dropped, which is what Meta's own
 * examples do. A single-token name yields only `fn` — hashing the same token into both fields
 * would assert a surname we were never told.
 */
export function splitName(full: string | null | undefined): { first: string; last: string } {
  const parts = (full ?? "").trim().split(/\s+/).filter((p) => p !== "");
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts[parts.length - 1] };
}

/**
 * The `user_data` object of a CAPI event. Every key optional — see `buildUserData`.
 *
 * The hashed fields are ARRAYS, matching the payload in Meta's CRM integration guide
 * (`"em": ["<hash>"]`). A person can have more than one email or phone on file; we only ever
 * hold one, but sending the shape Meta documents costs nothing and leaves room to add the
 * second without changing the contract. `lead_id` is the exception — a plain number.
 */
export type CapiUserData = {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  external_id?: string[];
  /** Meta's own Instant Form lead id. Sent as a plain number — never hashed. */
  lead_id?: number;
};

export type CapiIdentity = {
  /** Our `form_leads.id`. Hashed into `external_id`. */
  leadRowId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** `form_leads.external_id`: Meta's lead id, or a `gmail:<message_id>` fallback. */
  externalId: string | null;
};

/**
 * Meta's Instant Form lead ids are numeric; our fallback is prefixed `gmail:` (see
 * `resolveExternalId` in features/form-leads/mapping.ts). So "all digits" is the test for
 * "this is Meta's own id".
 *
 * The leading `l:` is stripped first. Meta's own Ads Manager lead export writes ids that way
 * — `l:1352107040406960`, alongside `c:` for campaigns and `f:` for forms — and a lead
 * imported from that CSV would otherwise fail the digits test and silently lose `lead_id`,
 * which is the single strongest matching signal we have. Case-insensitive, since the prefix
 * is cosmetic either way.
 *
 * Bounded at 21 digits because the value has to survive as a JSON number: past
 * Number.MAX_SAFE_INTEGER precision is lost, and a silently-rounded lead id matches nobody.
 * Real ids are 15-17 digits, so this only ever rejects garbage.
 */
export function metaLeadId(externalId: string | null | undefined): number | undefined {
  const value = (externalId ?? "").trim().replace(/^l:/i, "");
  if (!/^\d{1,21}$/.test(value)) return undefined;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Build `user_data`, hashing everything except `lead_id`.
 *
 * Empty values are *omitted*, never sent as the hash of "". Meta counts a present-but-blank
 * parameter against the Event Match Quality score, so an absent field genuinely beats a
 * hollow one.
 *
 * `lead_id` is the strongest signal available to us by a wide margin — it's Meta's own
 * primary key for the lead, so attribution is exact rather than probabilistic. The hashed
 * contact fields still go along with it: they're what carries the match when the lead came
 * in through the Gmail fallback with no Meta id attached.
 */
export function buildUserData(identity: CapiIdentity): CapiUserData {
  const out: CapiUserData = {};

  const email = normalizeEmail(identity.email);
  if (email !== "") out.em = [sha256Hex(email)];

  const phone = toE164Digits(identity.phone);
  if (phone !== "") out.ph = [sha256Hex(phone)];

  const { first, last } = splitName(identity.name);
  const fn = normalizeName(first);
  const ln = normalizeName(last);
  if (fn !== "") out.fn = [sha256Hex(fn)];
  if (ln !== "") out.ln = [sha256Hex(ln)];

  // Our own stable id for the person. Hashed like any other identifier, and useful to Meta
  // even alone: it lets repeat events for one lead be recognized as the same person.
  const rowId = (identity.leadRowId ?? "").trim();
  if (rowId !== "") out.external_id = [sha256Hex(rowId)];

  const leadId = metaLeadId(identity.externalId);
  if (leadId !== undefined) out.lead_id = leadId;

  return out;
}
