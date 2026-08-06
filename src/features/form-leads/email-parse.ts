// Parses a "Lead Nova" notification email into the flat label -> answer map that
// `mapSheetFields` consumes.
//
// An n8n workflow watches Gmail for the subject "Lead Nova" and POSTs the message's text to
// /api/leads/form; the lead's details are in the body as one `Label: value` per line. Parsing
// happens here rather than in an n8n Code node so it can be unit-tested and so a change to
// the sending automation's template is a test, not an edit in a browser.
//
// Deliberately permissive: an unrecognized line is skipped, never thrown on. A template tweak
// must cost us at most one field, never the whole lead — whatever *is* recognized still maps,
// and every recognized line is kept verbatim in `form_leads.raw`.
//
// Pure (no I/O). See email-parse.test.ts.

/** Block-level tags whose close is a line break once the markup is gone. */
const BLOCK_END = /<\/?(?:br|p|div|tr|li|h[1-6]|table|ul|ol|blockquote)\b[^>]*>/gi;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * Reduce an HTML body to the plain text the parser wants.
 *
 * Only reached when the sender delivers HTML and no `text/plain` alternative — n8n's Gmail
 * Trigger normally hands over `text`. Entities are decoded *after* the tags are stripped, so
 * an escaped `&lt;p&gt;` in the lead's own answer can't be mistaken for markup.
 */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(BLOCK_END, "\n")
      .replace(/<[^>]*>/g, "")
  ).replace(/\r\n?/g, "\n");
}

function looksLikeHtml(text: string): boolean {
  return /<(?:br|p|div|table|tr|td|span|a|html|body)\b[^>]*>/i.test(text);
}

// A label is short, has something alphanumeric in it, and isn't a URI scheme. The scheme list
// keeps a bare "https://..." line out of `raw`; the length bound keeps a long prose line that
// happens to contain a colon from being read as a field.
//
// The bound is deliberately generous, and short prose ("Enviado em: ...") does slip through.
// That is the safe direction: an unmapped label costs one junk key in `raw`, while a tighter
// bound would silently drop a real form question — Meta lets them run to a full sentence.
//
// `data` is NOT in the scheme list even though `data:` URIs exist: matching is
// case-insensitive, so it would swallow the Portuguese label "Data:".
const MAX_LABEL_LENGTH = 60;
const URI_SCHEME = /^(?:https?|ftp|mailto|tel)$/i;

function isUsableLabel(label: string): boolean {
  if (label.length === 0 || label.length > MAX_LABEL_LENGTH) return false;
  if (URI_SCHEME.test(label)) return false;
  return /[\p{L}\p{N}]/u.test(label);
}

/**
 * Split on the *first* colon: the label can't contain one, but a value routinely does
 * (`Data: 31/07/2026 14:23:05`).
 *
 * The optional bullet prefix covers templates that render the fields as a list; it requires
 * whitespace after the marker so a signature delimiter ("-- ") isn't mistaken for one.
 */
const FIELD_LINE = /^[\s>]*(?:[-*•·]\s+)?([^:]*?)\s*:\s*(.*?)\s*$/;

export function parseLeadEmail(text: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== "string" || text.trim() === "") return out;

  const plain = looksLikeHtml(text) ? htmlToText(text) : text.replace(/\r\n?/g, "\n");

  for (const line of plain.split("\n")) {
    const match = FIELD_LINE.exec(line);
    if (!match) continue;

    const [, label, value] = match;
    // A label with no value is skipped rather than stored blank, so `pick` falls through to
    // the next alias instead of settling on an empty answer.
    if (value === "" || !isUsableLabel(label)) continue;
    // First occurrence wins, matching how mapSheetFields resolves colliding headers.
    if (!(label in out)) out[label] = value;
  }

  return out;
}
