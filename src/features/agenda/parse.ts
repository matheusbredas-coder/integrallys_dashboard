/**
 * Pure parsers for Gestek's agenda responses. No I/O, so the shapes below can be
 * pinned to real captured payloads in tests. Ported from the bot's
 * `booking/gestekParse.ts` — see slots.ts for why the rule lives on both sides.
 *
 * Deliberately defensive. Gestek's public Swagger declares every one of these
 * responses as a bare `"OK"` with no schema at all — the structures handled here
 * were established by issuing live calls, not by contract, so a field moving or an
 * entry arriving malformed has to degrade to "no slots that day" rather than throw
 * and blank the whole page.
 */

import { utcIsoToLocal } from "./time";

type Json = Record<string, unknown>;

const asObj = (v: unknown): Json | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asStr = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** A booking already on the calendar, reduced to what packing needs. */
export interface GestekDayBooking {
  agendaId: string;
  /** Gestek's own UTC timestamp, kept verbatim. */
  startAtUtc: string;
  /**
   * The CLINIC-LOCAL calendar date this booking falls on.
   *
   * Load-bearing, not decoration: Gestek's own date filter is inexact, so without
   * filtering on this a neighbouring day's appointments anchor the packing rule.
   */
  dateISO: string;
  /** Minutes from clinic-local midnight. */
  startMin: number;
  procedureDurations: number[];
  clienteNome: string | null;
}

/**
 * `agenda-disponivel` -> the free start times, as "HH:MM" clinic-local.
 *
 * Observed shape: `[{ profissional: {...}, horarios: ["12:00", "12:30", ...] }]`.
 * When `profissionalId` is given only that professional's entry is read, so a
 * second one cannot silently contribute slots nobody can work.
 */
export function parseAvailableSlots(body: unknown, profissionalId?: string): string[] {
  const entries = Array.isArray(body) ? body : asArr(asObj(body)?.horariosDisponiveis);
  const out: string[] = [];
  for (const entry of entries) {
    const obj = asObj(entry);
    if (!obj) continue;
    if (profissionalId) {
      const id = asStr(asObj(obj.profissional)?.id);
      if (id && id !== profissionalId) continue;
    }
    for (const slot of asArr(obj.horarios)) {
      const time = asStr(slot);
      if (time) out.push(time);
    }
  }
  // Two professionals could offer the same wall-clock time; the packer treats the
  // day as one resource, so duplicates would double-count.
  return [...new Set(out)];
}

/**
 * `GET /api/agenda` -> the day's bookings.
 *
 * This — not the availability grid — is the authority on what is occupied: staff
 * book outside the grid (real 11:30 appointments exist on a grid that starts at
 * 12:00), and those blocks still have to anchor the packing rule.
 *
 * Entries with no id or no parseable start are dropped: a booking that cannot be
 * placed on the clock is worse than absent, because it would anchor slots at the
 * wrong hour.
 */
export function parseDayBookings(body: unknown): GestekDayBooking[] {
  const root = Array.isArray(body) ? asObj(body[0]) : asObj(body);
  const out: GestekDayBooking[] = [];

  for (const entry of asArr(root?.agendamentos)) {
    const obj = asObj(entry);
    if (!obj) continue;
    const agendaId = asStr(obj.id);
    const startAtUtc = asStr(obj.dataAgendamentoInicio);
    if (!agendaId || !startAtUtc) continue;
    const local = utcIsoToLocal(startAtUtc);
    if (!local) continue;

    const procedureDurations: number[] = [];
    for (const proc of asArr(obj.procedimentos)) {
      const duration = asObj(proc)?.duracaoMinutos;
      if (typeof duration === "number" && Number.isFinite(duration)) procedureDurations.push(duration);
    }

    out.push({
      agendaId,
      startAtUtc,
      dateISO: local.dateISO,
      startMin: local.minutes,
      procedureDurations,
      clienteNome: asStr(obj.clienteNome) ?? null,
    });
  }
  return out;
}
