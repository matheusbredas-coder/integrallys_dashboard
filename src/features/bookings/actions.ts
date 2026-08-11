"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// Session guard, same shape as features/form-leads/actions.ts: the service-role
// client below bypasses RLS, so every action must first prove there's a real
// logged-in user.
async function requireUser(): Promise<{ email: string } | { error: string }> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { error: "Sessão expirada. Entre novamente." };
  return { email: user.email ?? user.id };
}

/**
 * Approve a PIX receipt.
 *
 * This does NOT book anything. It records the decision and the bot's scheduler
 * picks it up on its next tick, re-checks the slot against Gestek, and creates
 * the appointment. The split is deliberate: the bot owns every Gestek write and
 * every message to the lead, so there is exactly one place where "approved"
 * turns into an appointment — and it is the place that can also tell the lead
 * when her slot was taken in the meantime.
 *
 * Guarded on status='proof_received' so two staff clicking at once cannot
 * double-approve, and so a row the bot has already moved on from is not dragged
 * backwards.
 */
export async function approveDeposit(id: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  if ("error" in user) return user;
  if (!id) return { error: "Sinal não informado." };

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_bookings")
    .update({
      status: "approved",
      approved_by: user.email,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Cleared so a stale failure note from an earlier attempt doesn't linger
      // on a row that is now expected to succeed.
      note: null,
    })
    .eq("id", id)
    .eq("status", "proof_received")
    .select("id");

  if (error) {
    console.error("[bookings] approve failed", error);
    return { error: "Não foi possível aprovar o sinal." };
  }
  if (!data?.[0]) return { error: "Esse sinal já foi decidido por outra pessoa." };

  revalidatePath("/marketing");
  return { ok: true };
}

/**
 * Refuse a receipt — an unreadable photo, a wrong amount, the wrong recipient.
 *
 * The lead keeps her slot: the bot moves the booking back to 'held' with a fresh
 * window and asks for another photo. Refusing is "send me a better one", not
 * "you lose the appointment".
 */
export async function rejectDeposit(id: string): Promise<{ ok: true } | { error: string }> {
  const user = await requireUser();
  if ("error" in user) return user;
  if (!id) return { error: "Sinal não informado." };

  const sb = createSupabaseServiceClient();
  const { data, error } = await sb
    .from("bot_bookings")
    .update({
      status: "rejected",
      approved_by: user.email,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      // Left null on purpose: the bot's rejection query filters on note IS NULL
      // to pick each refusal up exactly once, then writes its own note.
      note: null,
    })
    .eq("id", id)
    .eq("status", "proof_received")
    .select("id");

  if (error) {
    console.error("[bookings] reject failed", error);
    return { error: "Não foi possível recusar o sinal." };
  }
  if (!data?.[0]) return { error: "Esse sinal já foi decidido por outra pessoa." };

  revalidatePath("/marketing");
  return { ok: true };
}
