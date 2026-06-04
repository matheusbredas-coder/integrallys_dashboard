import { formatBRL, formatInt, parseGestekDate, formatDate } from "@/lib/format";
import type { Row, ColType, ColumnDef } from "./types";

const KNOWN: Record<string, { label: string; type: ColType }> = {
  id: { label: "ID", type: "text" },
  Nome: { label: "Nome", type: "text" },
  "Telefone Principal": { label: "Telefone", type: "text" },
  "Email Principal": { label: "Email", type: "text" },
  Origem: { label: "Origem", type: "text" },
  "Data do Cadastro": { label: "Cadastro", type: "date" },
  "Numero de Vendas": { label: "Vendas", type: "int" },
  "Receita Total": { label: "Receita", type: "currency" },
  Descontos: { label: "Descontos", type: "currency" },
  "Ticket Medio": { label: "Ticket médio", type: "currency" },
  Procedimentos: { label: "Procedimentos", type: "text" },
};
const ORDER = ["Nome", "Telefone Principal", "Email Principal", "Origem", "Numero de Vendas",
  "Receita Total", "Ticket Medio", "Descontos", "Data do Cadastro", "Procedimentos", "id"];

function humanize(k: string) {
  return k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function detectType(rows: Row[], key: string): ColType {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  if (vals.length && vals.every((v) => !isNaN(Number(String(v).trim())))) return "int";
  return "text";
}

export function buildColumns(rows: Row[]): ColumnDef[] {
  const keys = new Set<string>();
  for (const r of rows.slice(0, 50)) Object.keys(r).forEach((k) => keys.add(k));
  const unknown = [...keys].filter((k) => !ORDER.includes(k));
  // Insert unknown columns before the last ORDER entry ("id") so "id" stays last.
  const idInData = keys.has("id");
  const orderWithoutId = ORDER.filter((k) => k !== "id" && keys.has(k));
  const ordered = [
    ...orderWithoutId,
    ...unknown,
    ...(idInData ? ["id"] : []),
  ];
  return ordered.map((key) => {
    const known = KNOWN[key];
    return known ? { key, label: known.label, type: known.type } : { key, label: humanize(key), type: detectType(rows, key) };
  });
}

function asDate(v: unknown): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return parseGestekDate(s) ?? (isNaN(Date.parse(s)) ? null : new Date(s));
}

export function formatCell(v: unknown, type: ColType): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.trim() === "") return "—";
  if (type === "currency") return formatBRL(s);
  if (type === "int") return formatInt(s);
  if (type === "date") { const d = asDate(s); return d ? formatDate(d) : s; }
  return s;
}

export function sortValue(v: unknown, type: ColType): number | string {
  const s = String(v ?? "").trim();
  if (type === "text") return s.toLowerCase();
  if (type === "date") { const d = asDate(s); return d ? d.getTime() : -Infinity; }
  if (s === "") return -Infinity;
  const n = Number(s);
  return isNaN(n) ? -Infinity : n;
}
