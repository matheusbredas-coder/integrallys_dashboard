"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchConnectionState, normalizePhone, requestPairing, type ConnectionState, type PairingResult } from "./evolution";

async function signedIn(): Promise<boolean> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  return Boolean(user);
}

export async function getWhatsAppState(): Promise<{ state: ConnectionState } | { error: string }> {
  if (!(await signedIn())) return { error: "Sessão expirada. Entre novamente." };
  try {
    return { state: await fetchConnectionState() };
  } catch (e) {
    console.error("[whatsapp-pairing] state failed", e);
    return { error: "Não foi possível falar com a Evolution." };
  }
}

/** QR code always; pairing code too when a phone number is given. */
export async function generatePairing(phone: string): Promise<PairingResult | { error: string }> {
  if (!(await signedIn())) return { error: "Sessão expirada. Entre novamente." };
  let number: string | undefined;
  if (phone.trim()) {
    const n = normalizePhone(phone);
    if (!n) return { error: "Número inválido. Use DDD + número, ex.: 27 99968-7380." };
    number = n;
  }
  try {
    return await requestPairing(number);
  } catch (e) {
    console.error("[whatsapp-pairing] connect failed", e);
    return { error: "Não foi possível gerar o código. Tente de novo." };
  }
}
