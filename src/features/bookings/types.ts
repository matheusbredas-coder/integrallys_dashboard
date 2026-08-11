/** A row of public.bot_bookings (migration 025). */
export type BookingStatus =
  | "proposed"
  | "held"
  | "proof_received"
  | "approved"
  | "booked"
  | "expired"
  | "rejected"
  | "slot_lost";

export type BookingRow = {
  id: string;
  lead_id: string;
  form_lead_id: string | null;
  phone: string;
  cliente_nome: string | null;
  slot_at: string;
  hold_expires_at: string | null;
  status: BookingStatus;
  proof_path: string | null;
  proof_at: string | null;
  agenda_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reminders_sent: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

/** A pending deposit, with a short-lived signed URL for its receipt image. */
export type PendingDeposit = BookingRow & {
  /**
   * Signed URL for the receipt in the PRIVATE bot-comprovantes bucket. Null when
   * the file is missing or the signature could not be minted — the row still has
   * to be shown, because a receipt nobody can approve is worse than a broken
   * thumbnail.
   */
  proof_url: string | null;
};
