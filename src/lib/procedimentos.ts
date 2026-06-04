export type Procedure = { name: string; qty: number };

// Items are separated by ", " but names may contain commas (e.g. "2,5 MG") and
// parentheses (e.g. "(PROMOCIONAL)"). The count is the trailing "(N)" of each item.
const ITEM_RE = /(.+?)\((\d+)\)(?=\s*,|\s*$)/g;

export function parseProcedimentos(raw: string | null | undefined): Procedure[] {
  if (!raw) return [];
  const out: Procedure[] = [];
  ITEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ITEM_RE.exec(raw)) !== null) {
    const name = m[1].replace(/^[\s,]+/, "").trim();
    const qty = parseInt(m[2], 10);
    if (name) out.push({ name, qty });
  }
  return out;
}

export function topProcedures(rows: (string | null | undefined)[], limit = 6): Procedure[] {
  const totals = new Map<string, number>();
  const lastSeen = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    for (const p of parseProcedimentos(rows[i])) {
      totals.set(p.name, (totals.get(p.name) ?? 0) + p.qty);
      lastSeen.set(p.name, i);
    }
  }
  return [...totals.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty || (lastSeen.get(b.name) ?? 0) - (lastSeen.get(a.name) ?? 0))
    .slice(0, limit);
}
