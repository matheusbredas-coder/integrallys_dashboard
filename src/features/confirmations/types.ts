// Wire shape sent to the bot's POST /api/confirmations/run. Kept minimal — just
// enough for the bot to render a template message and key its own state.
export type ConfirmationBookingPayload = {
  agendaId: string;
  phone: string;
  nome: string | null;
  startAt: string; // ISO, from GestekAgenda.dataAgendamentoInicio
  procedimento: string | null;
  profissional: string | null;
};

export type ConfirmationsSendResult = { sent: number; skipped: number; failed: number };

export type ConfirmationsRunResult =
  | ({ ok: true; dayISO: string; fetched: number; pendingCount: number } & ConfirmationsSendResult)
  | { ok: false; code: "gestek_error" | "bot_error"; message: string; dayISO: string };
