// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Build Update Payload"
//
// Transforms the accumulator into the JSONB payload accepted by the Postgres
// RPC `bulk_update_patient_metrics(payload jsonb)`.
//
// The target columns on public."Clientes" are all TEXT, so numeric values
// are emitted as plain-ASCII strings ("2500.00", "5", "125.75"). Dashboard
// formats for display.
//
// Upstream:
//   $('Aggregate Sales').first().json  → { accumulator, totalSalesAggregated }
//   $('Split Patients').first().json   → { existingIds, newGestekClients, ... }
//
// Output (single item):
//   {
//     rpcPayload:     [{ id, procedimentos, numero_de_vendas,
//                        receita_total, descontos, ticket_medio }],
//     unmatchedSales: [{ clienteId, sale_count }],
//     rowCount: number
//   }
// ─────────────────────────────────────────────────────────────────────────────

const { accumulator } = $('Aggregate Sales').first().json;
const { existingIds, newGestekClients } = $('Split Patients').first().json;

const knownIds = new Set([
  ...existingIds,
  ...newGestekClients.map((c) => c.id),
]);

const money = (n) => (Math.round(n * 100) / 100).toFixed(2);
const count = (n) => String(n);

const rpcPayload = [];
const unmatchedSales = [];

for (const [id, agg] of Object.entries(accumulator)) {
  if (!knownIds.has(id)) {
    unmatchedSales.push({ clienteId: id, sale_count: agg.vendas });
    continue;
  }

  const procedimentos = Object.entries(agg.procedimentos)
    .sort((a, b) => b[1] - a[1])
    .map(([nome, qty]) => `${nome} (${qty})`)
    .join(', ');

  rpcPayload.push({
    id,
    procedimentos: procedimentos || null,
    numero_de_vendas: count(agg.vendas),
    receita_total: money(agg.receita),
    descontos: money(agg.descontos),
    ticket_medio: agg.vendas > 0 ? money(agg.receita / agg.vendas) : null,
  });
}

return [
  {
    json: {
      rpcPayload,
      unmatchedSales,
      rowCount: rpcPayload.length,
    },
  },
];
