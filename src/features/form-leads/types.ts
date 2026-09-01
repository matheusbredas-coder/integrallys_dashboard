/** A row of public.form_leads (migration 021). */
export type FormLeadRow = {
  id: string;
  source: string;
  external_id: string | null;
  sheet_row: number | null;
  campaign: string | null;
  form_name: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  raw: Record<string, string>;
  /** Treatment programme (migration 022). Lowercase in the DB, capitalized for display. */
  protocolo: string;
  stage: FormLeadStage;
  notes: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * The caller's kanban board on /marketing (migration 028). Deliberately NOT part
   * of the funnel above — see BOARD_COLUMNS.
   */
  board_column: BoardColumn | null;
  call_attempts: number;
  last_call_at: string | null;
  next_call_at: string | null;
};

/**
 * The funnel a form lead moves through, in order. This constant — not a DB CHECK
 * constraint — is the source of truth: `updateFormLeadStage` validates against it, so
 * adding a stage is a one-line code change with no migration. Keep `novo` first; it's
 * the column default in migration 021.
 *
 * Two things move a lead through it now: a human picking a stage in the table's
 * dropdown on /marketing, and the Lead Qualifier Bot, which reports `contatado` when
 * it opens the conversation and `agendado` once a booking lands in Gestek. The bot
 * goes through POST /api/leads/form/stage rather than writing the column, so the Meta
 * CAPI event fires either way — and that endpoint refuses `perdido` and `ganho`, which
 * stay human-only decisions, and refuses to move a lead backwards at all (see
 * stage-order.ts).
 *
 * The kanban board on the same page does NOT move a lead through this funnel; it has
 * its own field. See BOARD_COLUMNS below.
 */
/**
 * `contatado` and `respondeu` look similar but are opposites in the only way that matters:
 * `contatado` records something *we* did (a WhatsApp message went out), while `respondeu`
 * records something the *lead* did. Every lead we work reaches `contatado`, so on its own it
 * carries no information — it's the reply that separates a real prospect from a form fill.
 * The distinction is what Meta's Conversions API learns from. See docs/meta-capi.md.
 */
export const FORM_LEAD_STAGES = [
  "novo",
  "contatado",
  "respondeu",
  "qualificado",
  "agendado",
  "ganho",
  "perdido",
] as const;

export type FormLeadStage = (typeof FORM_LEAD_STAGES)[number];

export const STAGE_LABELS: Record<FormLeadStage, string> = {
  novo: "Novo",
  contatado: "Contatado",
  respondeu: "Respondeu",
  qualificado: "Qualificado",
  agendado: "Agendado",
  ganho: "Ganho",
  perdido: "Perdido",
};

export function isFormLeadStage(v: unknown): v is FormLeadStage {
  return typeof v === "string" && (FORM_LEAD_STAGES as readonly string[]).includes(v);
}

/** Display label for a stage, tolerating legacy/unknown values already in the DB. */
export function stageLabel(stage: string): string {
  return isFormLeadStage(stage) ? STAGE_LABELS[stage] : stage;
}

/**
 * The columns of the caller's kanban board on /marketing (migration 028).
 *
 * This is NOT the funnel. `stage` above is a shared contract — three writers, and
 * every write fires an irreversible Meta CAPI conversion event — while this is one
 * person's worklist for the phone. The board never writes `stage` and never touches
 * Meta, which is also what keeps it from ever disturbing the bot's `stage='novo'`
 * outbound gate. The two can disagree (the board's "Agendado" is the caller's note;
 * `stage='agendado'` is a booking that actually landed in Gestek), and that is the
 * intended behaviour, not a defect — the card shows both.
 *
 * `null` is the implicit first column, "A ligar", so a brand new lead needs no write
 * to appear on the board. Order here is the left-to-right order on screen.
 */
export const BOARD_COLUMNS = [
  "nao_atendeu",
  "retorno",
  "qualificado",
  "agendado",
  "removido",
] as const;

export type BoardColumn = (typeof BOARD_COLUMNS)[number];

/** The implicit column a lead sits in until the caller moves her. Not a DB value. */
export const A_LIGAR = "a_ligar" as const;

/** Every column the board renders, including the implicit one, left to right. */
export const BOARD_COLUMN_KEYS = [A_LIGAR, ...BOARD_COLUMNS] as const;

export type BoardColumnKey = (typeof BOARD_COLUMN_KEYS)[number];

export const BOARD_COLUMN_LABELS: Record<BoardColumnKey, string> = {
  a_ligar: "A ligar",
  nao_atendeu: "Não atendeu",
  retorno: "Retorno marcado",
  qualificado: "Qualificado",
  agendado: "Agendado",
  removido: "Removido",
};

export function isBoardColumn(v: unknown): v is BoardColumn {
  return typeof v === "string" && (BOARD_COLUMNS as readonly string[]).includes(v);
}
