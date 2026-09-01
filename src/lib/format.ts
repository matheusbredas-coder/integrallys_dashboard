function toNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function formatBRL(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : brl.format(n).replace(/ /g, " ");
}

export function formatInt(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : int.format(n).replace(/ /g, " ");
}

const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function formatPct(v: number | string | null | undefined): string {
  const n = toNumber(v);
  return n === null ? "—" : `${pct.format(n)}%`;
}

export function parseGestekDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  return new Date(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi));
}

export function formatDate(d: Date | null): string {
  if (!d) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// Timestamps are stored as timestamptz and rendered by server components, so the runtime's
// zone is whatever Vercel's is (UTC) — pinning America/Sao_Paulo is what makes a lead that
// arrived at 22:30 BRT read as the 5th rather than the 6th.
const dateTimeBrt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** An ISO timestamp as "DD/MM/YYYY, HH:MM" in BRT, or "—" if there isn't a usable one. */
export function formatDateTimeBrt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeBrt.format(d);
}

/**
 * A stored phone as someone in Brazil would read it: "27 98182-0451". Phones are
 * stored digits-only with the country code (see migration 021), which is what the
 * bot and Evolution need but is noise on screen.
 *
 * Handles both 9-digit mobiles and 8-digit landlines. Anything that doesn't look
 * like a Brazilian number is returned as-is rather than mangled — a few rows were
 * imported with the phone and email swapped, and they should look wrong, not tidy.
 */
export function formatPhoneBr(phone: string | null | undefined): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  if (local.length !== 10 && local.length !== 11) return phone;
  const ddd = local.slice(0, 2);
  const rest = local.slice(2);
  return `${ddd} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
}
