import type { ReactivationFunnel } from "./funnel";
import type { Track } from "./classify";

export type CampaignStatus = "draft" | "published" | "paused" | "done";

export type AudienceFilter = {
  minMonthsSinceLastVisit: number | null;
  procedureKeyword: string | null;
  minTotalSpend: number | null;
  neverRebooked: boolean;
};

export const EMPTY_AUDIENCE_FILTER: AudienceFilter = {
  minMonthsSinceLastVisit: null,
  procedureKeyword: null,
  minTotalSpend: null,
  neverRebooked: false,
};

export type CampaignRow = {
  id: string;
  name: string;
  status: CampaignStatus;
  tracks: ReactivationFunnel;
  audience_filter: AudienceFilter;
  keyword_rosto: string[];
  keyword_medidas: string[];
  keyword_reserved: string[];
  audience_snapshot: { cliente_id: string; track: Track }[] | null;
  audience_count: number;
  sent_count: number;
  delivered_count: number;
  replied_count: number;
  booked_count: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};
