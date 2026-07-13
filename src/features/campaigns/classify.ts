import { parseProcedimentos } from "@/lib/procedimentos";
import type { PatientSale } from "@/features/patients/types";

export type Track = "rosto" | "medidas";
export type TrackResult = Track | "reserved";

export interface TrackKeywords {
  rosto: string[];
  medidas: string[];
  /** Held out of this campaign for their own future sequence. */
  reserved: string[];
}

// Editable defaults — the campaign UI will let users tune these. Reserved is
// checked FIRST so "LIPO DE PAPADA" doesn't get swallowed by a medidas keyword.
export const DEFAULT_TRACK_KEYWORDS: TrackKeywords = {
  reserved: ["LIPO DE PAPADA", "PAPADA", "PEIM", "SECAGEM DE MICROVASOS", "MICROVASOS"],
  medidas: [
    "MONJAURO", "MOUNJARO", "RETATRUTIDA", "ACELERADOR METABOLICO", "BCAA",
    "ENZIMA LEMON BOTTLE", "LIPO ENZIMATICA", "LIPOCAVITAÇÃO", "CORRENTE RUSSA",
    "DRENAGEM LINFÁTICA", "OZONIO CORPORAL", "VENTOSOTERAPIA", "MASSAGEM RELAXANTE",
    "NUTRICIONISTA", "NUTRICIONAL", "ENDOLASER",
  ],
  rosto: [
    "BOTOX", "PREENCHIMENTO", "BIOESTIMULADOR", "FIOS LISOS", "SKINBOOSTER", "PDRN",
    "MICROAGULHAMENTO", "LIMPEZA DE PELE", "PEELING", "LINE SKIN", "OZONIO FACIAL",
    "REVISÃO BOTOX",
  ],
};

/** Classify a single procedure name. Reserved > medidas > rosto; null if no match. */
export function classifyProcedure(name: string, kw: TrackKeywords): TrackResult | null {
  const up = name.toUpperCase();
  const has = (list: string[]) => list.some((k) => up.includes(k.toUpperCase()));
  if (has(kw.reserved)) return "reserved";
  if (has(kw.medidas)) return "medidas";
  if (has(kw.rosto)) return "rosto";
  return null;
}

/** Walk sales newest->oldest; first classifiable procedure wins; fallback "rosto". */
export function assignTrack(sales: PatientSale[], kw: TrackKeywords): TrackResult {
  const ordered = [...sales].sort((a, b) => (a.soldAt < b.soldAt ? 1 : a.soldAt > b.soldAt ? -1 : 0));
  for (const s of ordered) {
    for (const p of parseProcedimentos(s.procedimentos)) {
      const r = classifyProcedure(p.name, kw);
      if (r) return r;
    }
  }
  return "rosto";
}
