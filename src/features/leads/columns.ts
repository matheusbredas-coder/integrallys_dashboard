import { formatDate } from "@/lib/format";
import type { LeadRow } from "./types";

const FUNNEL_LABELS: Record<string, string> = {
  new: "Novo",
  greeted: "Saudado",
  qualifying: "Qualificando",
  pitched: "Apresentado",
  follow_up: "Follow-up",
  converted: "Convertido",
  opted_out: "Opt-out",
};

export function stageLabel(stage: string): string {
  return FUNNEL_LABELS[stage] ?? stage;
}

const DATE_KEYS: (keyof LeadRow)[] = ["last_activity_at", "created_at", "last_message_at", "block_until"];

export function formatLeadCell(row: LeadRow, key: keyof LeadRow): string {
  const v = row[key];
  if (key === "funnel_stage") return stageLabel(String(v));
  if (key === "is_blocked") return v ? "Bloqueado" : "—";
  if (v === null || v === undefined || String(v).trim() === "") return "—";
  if (DATE_KEYS.includes(key)) {
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? String(v) : formatDate(d);
  }
  return String(v);
}

export const LEAD_COLUMNS: { key: keyof LeadRow; label: string }[] = [
  { key: "name", label: "Nome" },
  { key: "id", label: "Telefone" },
  { key: "interest", label: "Interesse" },
  { key: "pain_point", label: "Dor" },
  { key: "funnel_stage", label: "Estágio" },
  { key: "follow_up_step", label: "Follow-up" },
  { key: "message_count", label: "Mensagens" },
  { key: "is_blocked", label: "Bloqueado" },
  { key: "last_activity_at", label: "Última atividade" },
];
