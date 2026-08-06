import "server-only";
import { postSlackMessage, type SlackBlock } from "@/lib/slack";
import { formatDateTimeBrt } from "@/lib/format";
import type { MappedLead } from "./mapping";

// Slack alert for a newly ingested Meta Instant Form lead. Only the ingest route calls
// this, and only after a row was genuinely inserted — never on a duplicate or a retry.

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
      elements: [
        { type: "mrkdwn", text: `Recebido em ${formatDateTimeBrt(lead.submitted_at)} (BRT)` },
      ],
    },
  ];

  return { blocks, fallbackText };
}

/** Fire-and-report: true if Slack accepted the message. Never throws. */
export async function notifyNewFormLead(lead: MappedLead): Promise<boolean> {
  const { blocks, fallbackText } = buildNewLeadBlocks(lead);
  return postSlackMessage(blocks, fallbackText);
}
