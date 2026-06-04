// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Generate Monthly Windows"
//
// Produces one output item per calendar month from min("Data do Cadastro") → today.
// Each item is consumed by a downstream "Split In Batches" → HTTP /api/vendas
// loop.
//
// "Data do Cadastro" is stored as text in Brazilian format "DD/MM/YY HH:MM",
// implicit São Paulo time (UTC-3, no DST since 2019).
//
// Window boundaries are INCLUSIVE on both ends:
//   start = YYYY-MM-01T00:00:00.000Z
//   end   = YYYY-MM-LASTDAYT23:59:59.999Z  (clamped to today if in current month)
//
// Upstream: $('Read Supabase Patients').all()
// Output: array of items, each { json: { start, end, label } }
// ─────────────────────────────────────────────────────────────────────────────

function parseBRDate(s) {
  const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yy, hh, mi] = m;
  return new Date(
    Date.UTC(
      2000 + parseInt(yy, 10),
      parseInt(mm, 10) - 1,
      parseInt(dd, 10),
      parseInt(hh, 10) + 3, // BRT → UTC
      parseInt(mi, 10)
    )
  );
}

const patients = $('Read Supabase Patients').all().map((i) => i.json);

const dateNums = patients
  .map((p) => parseBRDate(p['Data do Cadastro']))
  .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()))
  .map((d) => d.getTime());

if (dateNums.length === 0) {
  throw new Error(
    'No patients with parseable "Data do Cadastro" found in Clientes — cannot determine backfill start.'
  );
}

const minDate = new Date(Math.min(...dateNums));
const today = new Date();

const cursor = new Date(
  Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1, 0, 0, 0, 0)
);
const stopAt = new Date(
  Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
    23,
    59,
    59,
    999
  )
);

const out = [];
while (cursor.getTime() <= stopAt.getTime()) {
  const start = new Date(cursor);
  const lastDayOfMonth = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  const end = lastDayOfMonth.getTime() > stopAt.getTime() ? stopAt : lastDayOfMonth;

  out.push({
    json: {
      start: start.toISOString(),
      end: end.toISOString(),
      label: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
    },
  });

  cursor.setUTCMonth(cursor.getUTCMonth() + 1);
}

return out;
