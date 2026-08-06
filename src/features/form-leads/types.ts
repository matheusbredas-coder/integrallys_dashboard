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
};

/**
 * The funnel a form lead moves through, in order. This constant — not a DB CHECK
 * constraint — is the source of truth: `updateFormLeadStage` validates against it, so
 * adding a stage is a one-line code change with no migration. Keep `novo` first; it's
 * the column default in migration 021.
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
