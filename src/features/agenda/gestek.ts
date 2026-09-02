import "server-only";
import { BASE, fetchWithRetry } from "../sync/gestek-client";
import { GESTEK_PROCEDIMENTO_IDS, GESTEK_PROFISSIONAL_ID, GESTEK_SALA_ID, BOOKING_RULES } from "./rules";
import { parseAvailableSlots, parseDayBookings, type GestekDayBooking } from "./parse";
import { addDaysISO } from "./time";

/**
 * The two Gestek reads a day's availability needs.
 *
 * Same pair the bot makes (`booking/gestekClient.ts`): the availability grid says
 * which start times the professional's own schedule offers, and `GET /api/agenda`
 * says what is actually booked. Both are needed — staff book outside the grid, and
 * those appointments still anchor the packing rule.
 */

/** Free start times for `dateISO`, as "HH:MM" clinic-local, straight from Gestek. */
export async function availableSlots(dateISO: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const qs = new URLSearchParams({
    ProfissionalUsuarioId: GESTEK_PROFISSIONAL_ID,
    ProcedimentosDuracao: String(BOOKING_RULES.durationMin),
    Data: dateISO,
    SalaAtendimentoId: GESTEK_SALA_ID,
  });
  // Repeated key, not a comma list — the parameter is declared as an array.
  for (const id of GESTEK_PROCEDIMENTO_IDS) qs.append("ProcedimentosIds", id);

  const res = await fetchWithRetry(`${BASE}/agenda/agenda-disponivel?${qs.toString()}`, fetchImpl);
  if (!res.ok) throw new Error(`Gestek /agenda/agenda-disponivel returned ${res.status}`);
  return parseAvailableSlots(await res.json(), GESTEK_PROFISSIONAL_ID);
}

/**
 * Everything already booked on `dateISO`, clinic-local.
 *
 * The window is deliberately a day wider on each side, then narrowed locally.
 * Two separate problems make that necessary, and they pull in opposite directions:
 *
 *   - Gestek's filter over-returns. Asking for 2026-08-13 came back with that
 *     day's ten bookings AND the first two of the 14th (verified live).
 *   - A UTC window under-returns. The clinic is UTC-3, so `13T00:00Z-13T23:59Z`
 *     is really local 12th 21:00 -> 13th 20:59 and would clip a late appointment.
 */
export async function dayBookings(dateISO: string, fetchImpl: typeof fetch = fetch): Promise<GestekDayBooking[]> {
  const qs = new URLSearchParams({
    DataInicio: `${addDaysISO(dateISO, -1)}T00:00:00Z`,
    DataFim: `${addDaysISO(dateISO, 1)}T23:59:59Z`,
    Tipo: "0", // both realized and upcoming
    Limit: "100",
    Page: "0",
  });
  const res = await fetchWithRetry(`${BASE}/agenda?${qs.toString()}`, fetchImpl);
  if (!res.ok) throw new Error(`Gestek /agenda returned ${res.status}`);
  return parseDayBookings(await res.json()).filter((b) => b.dateISO === dateISO);
}
