import "server-only";
import type { GestekAgenda } from "@/features/sync/types";
import { fetchAgendaForDay } from "@/features/sync/gestek-client";
import { tomorrowDayISO } from "./date";
import type { ConfirmationBookingPayload, ConfirmationsRunResult, ConfirmationsSendResult } from "./types";

export type GestekApi = { fetchAgendaForDay: (dayISO: string) => Promise<GestekAgenda[]> };
export type BotApi = { sendBatch: (bookings: ConfirmationBookingPayload[]) => Promise<ConfirmationsSendResult> };
export type RunDeps = { gestek?: GestekApi; bot?: BotApi; now?: () => Date };

function toPayload(a: GestekAgenda): ConfirmationBookingPayload {
  return {
    agendaId: a.id,
    phone: a.clienteTelefone ?? "",
    nome: a.clienteNome ?? null,
    startAt: a.dataAgendamentoInicio ?? "",
    procedimento: a.procedimentos?.[0]?.nome ?? null,
    profissional: a.profissional?.nome ?? null,
  };
}

async function postToBot(bookings: ConfirmationBookingPayload[]): Promise<ConfirmationsSendResult> {
  const botBaseUrl = process.env.BOT_BASE_URL;
  const secret = process.env.CONFIRMATIONS_SHARED_SECRET;
  if (!botBaseUrl || !secret) throw new Error("BOT_BASE_URL and CONFIRMATIONS_SHARED_SECRET must be set");
  const res = await fetch(`${botBaseUrl.replace(/\/+$/, "")}/api/confirmations/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bookings }),
  });
  if (!res.ok) throw new Error(`Bot /api/confirmations/run returned ${res.status}`);
  return res.json();
}

/**
 * Day-before appointment confirmations: fetch tomorrow's Gestek bookings and hand the
 * still-pending ones to the bot, which owns WhatsApp template sending. Mirrors
 * run-sync.ts's injectable-deps shape so this is testable without touching Gestek or
 * the bot over the network.
 */
export async function runConfirmations(deps: RunDeps = {}): Promise<ConfirmationsRunResult> {
  const now = deps.now ?? (() => new Date());
  const dayISO = tomorrowDayISO(now());
  const gestek = deps.gestek ?? { fetchAgendaForDay };
  const bot = deps.bot ?? { sendBatch: postToBot };

  let agenda: GestekAgenda[];
  try {
    agenda = await gestek.fetchAgendaForDay(dayISO);
  } catch (e) {
    return { ok: false, code: "gestek_error", message: e instanceof Error ? e.message : "Falha ao buscar a agenda de amanhã.", dayISO };
  }

  // pendente=true is Gestek's "not yet realized" flag — cancelled bookings won't be in
  // this state, and a phone is required to have anywhere to send the message.
  const pending = agenda.filter((a) => a.pendente === true && a.id && a.clienteTelefone);
  const bookings = pending.map(toPayload);

  if (bookings.length === 0) {
    return { ok: true, dayISO, fetched: agenda.length, pendingCount: 0, sent: 0, skipped: 0, failed: 0 };
  }

  try {
    const result = await bot.sendBatch(bookings);
    return { ok: true, dayISO, fetched: agenda.length, pendingCount: bookings.length, ...result };
  } catch (e) {
    return { ok: false, code: "bot_error", message: e instanceof Error ? e.message : "Falha ao notificar o bot.", dayISO };
  }
}
