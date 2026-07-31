// Pure helpers for building WhatsApp click-to-chat links and short tracking slugs.
// No I/O here so it stays trivially unit-testable (see link.test.ts).

const SLUG_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Keep digits only. WhatsApp needs a country-code-prefixed number with no punctuation. */
export function normalizePhone(input: string): string {
  return (input ?? "").replace(/\D+/g, "");
}

/** E.164-ish sanity check: 10–15 digits once normalized (country code + number). */
export function isValidPhone(input: string): boolean {
  const digits = normalizePhone(input);
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Raw wa.me link with an optional prefilled message. This is the untracked link users
 * can copy directly; the tracked variant redirects here from /r/<slug>.
 */
export function buildWaMeUrl(phone: string, message = ""): string {
  const digits = normalizePhone(phone);
  const base = `https://wa.me/${digits}`;
  const text = (message ?? "").trim();
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** Public URL of a tracked link, e.g. https://crm.example.com/r/aB3xY9z2 */
export function trackedLinkUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/$/, "")}/r/${slug}`;
}

/**
 * Short URL-safe token for /r/<slug>. `rand` is injectable so tests are deterministic;
 * production uses the Web Crypto CSPRNG.
 */
export function randomSlug(size = 8, rand: (n: number) => Uint8Array = cryptoBytes): string {
  const bytes = rand(size);
  let out = "";
  for (let i = 0; i < size; i++) out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  return out;
}

function cryptoBytes(n: number): Uint8Array {
  const arr = new Uint8Array(n);
  globalThis.crypto.getRandomValues(arr);
  return arr;
}
