/**
 * Leads from a click-to-WhatsApp ad: she tapped the ad and wrote to the clinic, with no
 * form in between. The bot spots the ad mark on her first message and POSTs her to
 * /api/leads/whatsapp, which turns her into a card in "A ligar".
 *
 * Board only, by design (Matheus, 13/10/2026): the bot never talks to these people. The
 * card's source is what keeps it that way — the bot's outreach query skips
 * WHATSAPP_AD_SOURCE, so even dragging the card to "Não atendeu" sends nothing.
 *
 * Pure, no I/O. See whatsapp-ad.test.ts.
 */

export const WHATSAPP_AD_SOURCE = "whatsapp_ad";

export type WhatsAppAdBody = {
  phone?: unknown;
  name?: unknown;
  text?: unknown;
  ad?: { title?: unknown; adId?: unknown; sourceUrl?: unknown; ctwaClid?: unknown } | null;
};

export type WhatsAppAdRow = {
  source: string;
  external_id: string;
  campaign: string | null;
  form_name: string;
  name: string | null;
  phone: string;
  raw: Record<string, string>;
  submitted_at: string;
};

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * Digits with the mobile 9th digit restored.
 *
 * WhatsApp still addresses many older Brazilian mobiles without the 9 (`55 27 9968-7380`
 * instead of `55 27 99968-7380`), and a number dialled that way no longer rings. Brazilian
 * mobiles are exactly the 8-digit locals starting 6–9, so those get the 9 back; landlines
 * (2–5) are left alone. Null when it isn't a Brazilian number at all.
 */
export function normalizeWhatsAppPhone(raw: unknown): string | null {
  const digits = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  if (!/^55\d{10,11}$/.test(digits)) return null;
  if (digits.length === 12 && /[6-9]/.test(digits[4]!)) return `${digits.slice(0, 4)}9${digits.slice(4)}`;
  return digits;
}

/** The same number with and without the 9th digit, for finding a card she already has. */
export function phoneVariants(phone: string): string[] {
  if (phone.length === 13 && phone[4] === "9") return [phone, phone.slice(0, 4) + phone.slice(5)];
  return [phone];
}

/** The form_leads row for her, or null when the phone is unusable. */
export function buildWhatsAppAdRow(body: WhatsAppAdBody, now: Date = new Date()): WhatsAppAdRow | null {
  const phone = normalizeWhatsAppPhone(body.phone);
  if (!phone) return null;

  const ad = body.ad ?? {};
  const title = str(ad.title);
  // `raw` is what the notes drawer shows, so the labels are the caller's words.
  const raw: Record<string, string> = {};
  const entries: [string, unknown][] = [
    ["Mensagem", body.text],
    ["Anúncio", ad.title],
    ["ID do anúncio", ad.adId],
    ["Link do anúncio", ad.sourceUrl],
    ["ctwa_clid", ad.ctwaClid],
  ];
  for (const [label, value] of entries) {
    const v = str(value);
    if (v) raw[label] = v;
  }

  return {
    source: WHATSAPP_AD_SOURCE,
    // One card per number: a second tap on the ad is the same person, not a new lead.
    external_id: `whatsapp:${phone}`,
    campaign: title,
    form_name: "Anúncio no WhatsApp",
    name: str(body.name),
    phone,
    raw,
    submitted_at: now.toISOString(),
  };
}
