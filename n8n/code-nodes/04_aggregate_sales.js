// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Aggregate Sales"
//
// Consumes ALL items from every /api/vendas HTTP call (across every monthly
// window AND every page within each window) and produces a single item with
// the per-patient accumulator.
//
// Each input item's $json is the raw HTTP response body:
//   - { vendas: [...], totais: {...} }
//   - or [{ vendas: [...], totais: {...} }]
//
// Output (single item):
//   {
//     accumulator: {
//       [clienteId]: {
//         nome,
//         vendas,       // count of completed sales (status === 1)
//         receita,      // sum(total)
//         descontos,    // sum(desconto) at sale level
//         procedimentos: { [item_nome]: total_quantidade }
//       }
//     },
//     totalSalesAggregated: number
//   }
// ─────────────────────────────────────────────────────────────────────────────

const accumulator = {};
let totalSalesAggregated = 0;

for (const item of $input.all()) {
  let payload = item.json;
  if (Array.isArray(payload)) payload = payload[0];

  const vendas = (payload && payload.vendas) || [];
  for (const venda of vendas) {
    // Defensive: even though the URL filters by Status=1, double-check.
    if (venda.status !== 1) continue;
    if (!venda.clienteId) continue;

    const id = venda.clienteId;
    if (!accumulator[id]) {
      accumulator[id] = {
        nome: venda.cliente || null,
        vendas: 0,
        receita: 0,
        descontos: 0,
        procedimentos: {},
      };
    }
    const acc = accumulator[id];
    acc.vendas += 1;
    acc.receita += Number(venda.total) || 0;
    acc.descontos += Number(venda.desconto) || 0;

    for (const it of venda.itens || []) {
      const name = it.nome;
      const qty = Number(it.quantidade) || 0;
      if (!name) continue;
      acc.procedimentos[name] = (acc.procedimentos[name] || 0) + qty;
    }

    totalSalesAggregated += 1;
  }
}

return [
  {
    json: {
      accumulator,
      totalSalesAggregated,
    },
  },
];
