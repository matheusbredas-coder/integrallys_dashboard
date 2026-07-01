export type LeadRow = {
  id: string;
  channel: string;
  name: string | null;
  interest: string | null;
  pain_point: string | null;
  context: string | null;
  funnel_stage: string;
  follow_up_step: number;
  block_until: string | null;
  block_permanent: boolean;
  cliente_id: string | null;
  campaign: string | null;
  last_activity_at: string;
  created_at: string;
  is_blocked: boolean;
  message_count: number;
  last_message: string | null;
  last_message_at: string | null;
};

export type LeadMessage = {
  id: number;
  role: "lead" | "bot" | "human";
  content: string;
  created_at: string;
};
