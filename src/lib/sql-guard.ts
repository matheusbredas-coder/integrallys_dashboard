export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string };

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|into|call|merge|vacuum|reindex|comment|lock|listen|notify|set|reset)\b/i;

export function validateReadonlySql(raw: string): GuardResult {
  let q = (raw ?? "").trim();
  if (!q) return { ok: false, reason: "empty query" };
  if (q.endsWith(";")) q = q.slice(0, -1).trim();
  if (q.includes(";")) return { ok: false, reason: "only a single statement is allowed" };
  if (!/^(select|with)\b/i.test(q)) return { ok: false, reason: "only SELECT queries are allowed" };
  const m = q.match(FORBIDDEN);
  if (m) return { ok: false, reason: `disallowed keyword: ${m[1].toLowerCase()}` };
  return { ok: true, sql: q };
}
