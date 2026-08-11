import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { BookingRow, PendingDeposit } from "./types";

const PROOF_BUCKET = "bot-comprovantes";
/** Long enough to look at a receipt and decide, short enough not to be a link worth sharing. */
const SIGNED_URL_TTL_SECONDS = 60 * 15;

/**
 * Deposits waiting on a human, oldest first.
 *
 * Deliberately NOT cached, unlike getFormLeadsData: a lead is sitting in a
 * WhatsApp conversation waiting for this decision, and the signed URLs expire —
 * serving either from a 60-second cache would show stale rows and dead image
 * links. It is a handful of rows on an indexed query.
 */
export async function getPendingDeposits(): Promise<PendingDeposit[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_bookings")
    .select("*")
    .eq("status", "proof_received")
    .order("proof_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as BookingRow[];
  return Promise.all(
    rows.map(async (row) => {
      if (!row.proof_path) return { ...row, proof_url: null };
      // Receipts carry the lead's bank details, so the bucket is private and each
      // view is a fresh short-lived signature rather than a public URL.
      const { data: signed } = await sb.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(row.proof_path, SIGNED_URL_TTL_SECONDS);
      return { ...row, proof_url: signed?.signedUrl ?? null };
    })
  );
}

/** Recently decided deposits, so staff can see what they just did and spot mistakes. */
export async function getRecentDecidedDeposits(limit = 10): Promise<BookingRow[]> {
  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_bookings")
    .select("*")
    .in("status", ["approved", "booked", "rejected", "slot_lost"])
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as BookingRow[];
}
