"use server";

import { revalidateTag } from "next/cache";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getPatientsData } from "@/features/patients/data";
import { buildAudiencePreview, isFunnelReadyToPublish } from "./audience";
import { DEFAULT_TRACK_KEYWORDS, type TrackKeywords } from "./classify";
import { defaultReactivationFunnel, type ReactivationFunnel } from "./funnel";
import { EMPTY_AUDIENCE_FILTER, type AudienceFilter, type CampaignRow } from "./types";
import type { LeadRow } from "@/features/leads/types";

async function requireUser(): Promise<{ error: string } | null> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  return user ? null : { error: "Sessão expirada. Entre novamente." };
}

function keywordsFromRow(c: CampaignRow): TrackKeywords {
  return { rosto: c.keyword_rosto, medidas: c.keyword_medidas, reserved: c.keyword_reserved };
}

export async function createCampaign(): Promise<{ id: string } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const name = `Campanha de Reativação — ${new Date().toLocaleDateString("pt-BR")}`;
  const { data, error } = await sb.from("campaigns").insert({
    name,
    status: "draft",
    tracks: defaultReactivationFunnel,
    audience_filter: EMPTY_AUDIENCE_FILTER,
    keyword_rosto: DEFAULT_TRACK_KEYWORDS.rosto,
    keyword_medidas: DEFAULT_TRACK_KEYWORDS.medidas,
    keyword_reserved: DEFAULT_TRACK_KEYWORDS.reserved,
  }).select("id").single();
  if (error || !data) return { error: "Não foi possível criar a campanha." };

  revalidateTag("campaigns", { expire: 0 });
  return { id: data.id as string };
}

export async function getCampaignDetail(campaignId: string): Promise<{ campaign: CampaignRow; leads: LeadRow[] } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const [campaignRes, leadsRes] = await Promise.all([
    sb.from("campaigns").select("*").eq("id", campaignId).single(),
    sb.from("bot_leads_view").select("*").eq("campaign", campaignId).order("last_activity_at", { ascending: false }),
  ]);
  if (campaignRes.error || !campaignRes.data) return { error: "Campanha não encontrada." };
  if (leadsRes.error) return { error: "Não foi possível carregar as pacientes da campanha." };

  return { campaign: campaignRes.data as CampaignRow, leads: (leadsRes.data ?? []) as LeadRow[] };
}

export async function updateCampaignFilter(campaignId: string, filter: AudienceFilter): Promise<{ ok: true; audienceCount: number } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const { data: row, error: fetchError } = await sb.from("campaigns").select("keyword_rosto, keyword_medidas, keyword_reserved").eq("id", campaignId).single();
  if (fetchError || !row) return { error: "Campanha não encontrada." };

  const { salesByPatient } = await getPatientsData();
  const keywords: TrackKeywords = { rosto: row.keyword_rosto, medidas: row.keyword_medidas, reserved: row.keyword_reserved };
  const audienceCount = buildAudiencePreview(salesByPatient, filter, keywords).length;

  const { error } = await sb.from("campaigns").update({ audience_filter: filter, audience_count: audienceCount, updated_at: new Date().toISOString() }).eq("id", campaignId);
  if (error) return { error: "Não foi possível salvar o filtro de audiência." };

  revalidateTag("campaigns", { expire: 0 });
  return { ok: true, audienceCount };
}

export async function updateCampaignCopy(campaignId: string, tracks: ReactivationFunnel): Promise<{ ok: true } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const { error } = await sb.from("campaigns").update({ tracks, updated_at: new Date().toISOString() }).eq("id", campaignId);
  if (error) return { error: "Não foi possível salvar a copy da campanha." };

  revalidateTag("campaigns", { expire: 0 });
  return { ok: true };
}

export async function previewPublish(campaignId: string): Promise<{ count: number; blockedReason: string | null } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const { data: row, error } = await sb.from("campaigns").select("*").eq("id", campaignId).single();
  if (error || !row) return { error: "Campanha não encontrada." };
  const campaign = row as CampaignRow;

  const { salesByPatient } = await getPatientsData();
  const keywords = keywordsFromRow(campaign);
  const members = buildAudiencePreview(salesByPatient, campaign.audience_filter, keywords);

  if (!isFunnelReadyToPublish(campaign.tracks)) {
    return { count: members.length, blockedReason: "Nem todas as mensagens da campanha foram aprovadas ainda." };
  }
  if (members.length === 0) {
    return { count: 0, blockedReason: "Nenhuma paciente corresponde ao filtro de audiência." };
  }
  return { count: members.length, blockedReason: null };
}

export async function publishCampaign(campaignId: string): Promise<{ ok: true; count: number } | { error: string }> {
  const unauth = await requireUser();
  if (unauth) return unauth;

  const sb = createSupabaseServiceClient();
  const { data: row, error } = await sb.from("campaigns").select("*").eq("id", campaignId).single();
  if (error || !row) return { error: "Campanha não encontrada." };
  const campaign = row as CampaignRow;

  // Re-verify the gate server-side — never trust a client-side preview.
  const { salesByPatient } = await getPatientsData();
  const keywords = keywordsFromRow(campaign);
  const members = buildAudiencePreview(salesByPatient, campaign.audience_filter, keywords);
  if (!isFunnelReadyToPublish(campaign.tracks)) return { error: "Nem todas as mensagens da campanha foram aprovadas ainda." };
  if (members.length === 0) return { error: "Nenhuma paciente corresponde ao filtro de audiência." };

  const snapshot = members.map((m) => ({ cliente_id: m.clienteId, track: m.track }));
  const { error: updateError } = await sb.from("campaigns").update({
    status: "published",
    audience_snapshot: snapshot,
    audience_count: snapshot.length,
    published_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);
  if (updateError) return { error: "Não foi possível publicar a campanha." };

  revalidateTag("campaigns", { expire: 0 });
  return { ok: true, count: snapshot.length };
}
