import "server-only";
import { unstable_cache } from "next/cache";
import { availableSlots, dayBookings } from "./gestek";
import { BOOKING_RULES, MAX_WEEK_OFFSET } from "./rules";
import type { AgendaWeek } from "./types";
import { buildAgendaWeek, weekStartForOffset } from "./week";
import { CLINIC_UTC_OFFSET_MIN } from "./time";

function clinicClock(now: Date): string {
  const shifted = new Date(now.getTime() + CLINIC_UTC_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(11, 16);
}

async function fetchWeek(offset: number): Promise<AgendaWeek> {
  const now = new Date();
  const weekStartISO = weekStartForOffset(offset, now);
  const days = await buildAgendaWeek({ availableSlots, dayBookings }, BOOKING_RULES, weekStartISO, now);
  return { weekStartISO, offset, days, fetchedAt: clinicClock(now) };
}

/**
 * One week of offerable times, cached 60s under the "agenda" tag.
 *
 * Cached because the uncached page costs up to ten live Gestek calls on a token
 * shared with the nightly sync, and the caller reloads /marketing constantly. Sixty
 * seconds is short enough that a booking made in Gestek shows up on her next
 * refresh, and the "Atualizar" button clears it immediately when it matters.
 *
 * The offset is part of the cache key, so paging to next week is its own entry.
 */
export function getAgendaWeek(offset: number): Promise<AgendaWeek> {
  const clamped = Math.max(-MAX_WEEK_OFFSET, Math.min(MAX_WEEK_OFFSET, Math.trunc(offset) || 0));
  return unstable_cache(() => fetchWeek(clamped), ["agenda-week", String(clamped)], {
    revalidate: 60,
    tags: ["agenda"],
  })();
}
