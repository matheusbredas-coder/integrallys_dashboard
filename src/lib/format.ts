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
