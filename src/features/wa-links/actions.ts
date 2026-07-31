"use server";

import { revalidateTag } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { isValidPhone, normalizePhone, randomSlug } from "./link";

async function requireUser(): Promise<{ error: string } | null> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  return user ? null : { error: "Sessão expirada. Entre novamente." };
}

export async function createWaLink(input: {
  name: string;
  phone: string;
  message: string;
}): Promise<{ id: string; slug: string } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const name = input.name?.trim();
  const message = (input.message ?? "").trim();
  if (!name) return { error: "Dê um nome ao link." };
  if (!isValidPhone(input.phone)) return { error: "Número de telefone inválido (inclua o DDD e o país)." };

  const sb = createSupabaseServiceClient();
  const phone = normalizePhone(input.phone);

  // Retry on the rare slug collision (unique constraint 23505) before giving up.
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomSlug(8);
    const { data, error } = await sb
      .from("wa_links")
      .insert({ slug, name, phone, message })
      .select("id, slug")
      .single();
    if (!error && data) {
      revalidateTag("wa-links", { expire: 0 });
      return { id: data.id as string, slug: data.slug as string };
    }
    if (error && error.code !== "23505") {
      return { error: "Não foi possível criar o link." };
    }
  }
  return { error: "Não foi possível gerar um link único. Tente novamente." };
}

export async function deleteWaLink(id: string): Promise<{ ok: true } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("wa_links").delete().eq("id", id);
  if (error) return { error: "Não foi possível excluir o link." };

  revalidateTag("wa-links", { expire: 0 });
  return { ok: true };
}
