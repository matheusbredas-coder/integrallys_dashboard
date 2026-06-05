// Pure helpers for the Gestek "Relatório de Atendimentos" import.
// No xlsx/DB imports here so the mapping logic stays unit-testable.

import type { AttendanceStatus } from "@/features/overview/types";

// The clinic runs in America/Sao_Paulo, which is a fixed UTC-3 (Brazil dropped DST in 2019).
const SP_OFFSET_HOURS = 3;

export type ParsedRow = { cliente: string; dateText: string; statusText: string };

// What the report's Status column means for our override table.
//  - apply:   write this status onto the matched booking
//  - skip:    a known not-yet-resolved state (Agendado/Confirmado) — leave the default
//  - unknown: an unrecognized label — report it, never guess
export type StatusResult =
  | { kind: "apply"; status: Exclude<AttendanceStatus, "agendado"> }
  | { kind: "skip" }
  | { kind: "unknown" };

// Normalize a patient name for matching: strip accents, collapse whitespace, uppercase.
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

// "25/05/26 12:00" (local DD/MM/YY HH:MM) -> the equivalent UTC Date, or null if unparseable.
export function parseLocalDateTimeToUtc(dateText: string): Date | null {
  const m = dateText.trim().match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yy, hh, min] = m;
  const utcMs = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh) + SP_OFFSET_HOURS, Number(min));
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Minute-precision UTC key used to match a report row to a stored booking.
export function utcMinuteKey(d: Date): string {
  return d.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

// Composite match key: normalized name + appointment minute (UTC).
export function matchKey(name: string, when: Date): string {
  return `${normalizeName(name)}|${utcMinuteKey(when)}`;
}

// Map the report's Status label to our override decision. Substring-based so wording
// variants ("Finalizado Com Falta", "Não compareceu", "Cancelado pelo cliente") still map.
// Order matters: check 'falta' before 'finaliz' so "Finalizado Com Falta" -> falta.
export function mapStatus(raw: string): StatusResult {
  const n = normalizeName(raw); // also strips accents: "NAO COMPARECEU"
  if (!n) return { kind: "skip" };
  if (n.includes("FALTA") || n.includes("FALTOU") || n.includes("NAO COMPARECEU")) return { kind: "apply", status: "falta" };
  if (n.includes("CANCEL")) return { kind: "apply", status: "cancelado" };
  if (n.includes("FINALIZ") || n.includes("REALIZAD") || n.includes("ATENDID") || n.includes("COMPARECEU")) {
    return { kind: "apply", status: "realizado" };
  }
  if (n.includes("AGENDAD") || n.includes("CONFIRMAD") || n.includes("MARCAD") || n.includes("REMARCAD")) {
    return { kind: "skip" };
  }
  return { kind: "unknown" };
}
