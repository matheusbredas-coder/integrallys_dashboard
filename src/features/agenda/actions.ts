"use server";

import { revalidateTag } from "next/cache";

/**
 * Drop the 60-second availability cache.
 *
 * Exists because the one moment the cache is wrong is the moment it matters most:
 * the caller has just booked someone in Gestek and wants to see the day close up
 * before offering the next lead a time next to it.
 */
export async function refreshAgenda(): Promise<void> {
  revalidateTag("agenda", { expire: 0 });
}
