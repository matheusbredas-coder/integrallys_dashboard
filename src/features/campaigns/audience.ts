import { parseProcedimentos } from "@/lib/procedimentos";
import { assignTrack, type Track, type TrackKeywords } from "./classify";
import type { ReactivationFunnel } from "./funnel";
import type { AudienceFilter } from "./types";
import type { PatientSale } from "@/features/patients/types";

export function monthsBetween(from: Date, to: Date): number {
  // To handle timezone issues with Date parsing, we create a reference date
  // for one month after 'from' using explicit year/month/day parameters
  const oneMonthAfter = new Date(from.getFullYear(), from.getMonth() + 1, from.getDate());

  // If 'to' hasn't reached one month after 'from', they're in the same "month period"
  if (to < oneMonthAfter) {
    return 0;
  }

  // Calculate the month difference using getFullYear and getMonth
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());

  // If we've reached or passed the same day-of-month in the target month, add 1
  if (months > 0 && to.getDate() >= from.getDate()) {
    months += 1;
  }

  return months;
}

/** Does this patient's purchase history satisfy the audience filter? */
export function matchesAudienceFilter(sales: PatientSale[], filter: AudienceFilter, asOf: Date): boolean {
  if (sales.length === 0) return false; // no purchase history -> nothing to reactivate

  if (filter.neverRebooked && sales.length !== 1) return false;

  if (filter.minMonthsSinceLastVisit != null) {
    const lastVisit = sales.reduce((latest, s) => (s.soldAt > latest ? s.soldAt : latest), sales[0]!.soldAt);
    if (monthsBetween(new Date(lastVisit), asOf) < filter.minMonthsSinceLastVisit) return false;
  }

  if (filter.procedureKeyword) {
    const needle = filter.procedureKeyword.toUpperCase();
    const hasProcedure = sales.some((s) => parseProcedimentos(s.procedimentos).some((p) => p.name.toUpperCase().includes(needle)));
    if (!hasProcedure) return false;
  }

  if (filter.minTotalSpend != null) {
    const total = sales.reduce((sum, s) => sum + s.valorPago, 0);
    if (total < filter.minTotalSpend) return false;
  }

  return true;
}

export type AudienceMember = { clienteId: string; track: Track };

/** Patients matching the filter, each assigned a track; "reserved" patients are held out entirely. */
export function buildAudiencePreview(
  salesByPatient: Record<string, PatientSale[]>,
  filter: AudienceFilter,
  keywords: TrackKeywords,
  asOf: Date = new Date(),
): AudienceMember[] {
  const members: AudienceMember[] = [];
  for (const [clienteId, sales] of Object.entries(salesByPatient)) {
    if (!matchesAudienceFilter(sales, filter, asOf)) continue;
    const track = assignTrack(sales, keywords);
    if (track === "reserved") continue;
    members.push({ clienteId, track });
  }
  return members;
}

/** The hard publish gate: every step's copy must be approved before any send can happen. */
export function isFunnelReadyToPublish(funnel: ReactivationFunnel): boolean {
  return funnel.steps.every((s) => s.approvalStatus === "approved");
}
