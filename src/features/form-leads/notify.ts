import "server-only";
import { postSlackMessage, type SlackBlock } from "@/lib/slack";
import type { MappedLead } from "./mapping";

// Slack alert for a newly ingested Meta Instant Form lead. Only the ingest route calls
// this, and only after a row was genuinely inserted — never on a duplicate or a retry.

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "31/07/2026 14:23" in BRT, or "—" if we never got a usable timestamp. */
function formatBrt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTime.format(d);
}

/** Slack renders mrkdwn, so user-supplied text must not be able to inject formatting. */
function escapeMrkdwn(v: string | null): string {
  if (!v) return "—";
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Group fields two-per-row the way Slack's `fields` array renders them. */
function field(label: string, value: string | null): SlackBlock {
  return { type: "mrkdwn", text: `*${label}*\n${escapeMrkdwn(value)}` };
}

export function buildNewLeadBlocks(lead: MappedLead): {
  blocks: SlackBlock[];
  fallbackText: string;
} {
  const name = lead.name ?? "Sem nome";
  const fallbackText = `Novo lead do formulário: ${name}${lead.phone ? ` — ${lead.phone}` : ""}`;

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Novo lead — Meta Ads", emoji: false },
    },
    {
      type: "section",
      fields: [
        field("Nome", lead.name),
        field("Telefone", lead.phone),
        field("Campanha", lead.campaign),
        field("Formulário", lead.form_name),
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Recebido em ${formatBrt(lead.submitted_at)} (BRT)` }],
    },
  ];

  return { blocks, fallbackText };
}

/** Fire-and-report: true if Slack accepted the message. Never throws. */
export async function notifyNewFormLead(lead: MappedLead): Promise<boolean> {
  const { blocks, fallbackText } = buildNewLeadBlocks(lead);
  return postSlackMessage(blocks, fallbackText);
}
