// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Build Clientes Map"
//
// Consumes ALL items from the paginated /api/clientes loop and produces a
// single item containing:
//   - idMap:     { [gestek_client_id]: { nome, dataCriacao } }
//   - nameToId:  { [normalized_name]: gestek_client_id }
//   - duplicates: [{ level, message }] — name collisions
//   - totalClientes
//
// Each input item's $json is the raw HTTP response body:
//   - either: { clientes: [...], totais: {...} }
//   - or:    [{ clientes: [...], totais: {...} }] (wrapped)
// ─────────────────────────────────────────────────────────────────────────────

const normalize = (s) =>
  (s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const idMap = {};
const nameToId = {};
const duplicates = [];

for (const item of $input.all()) {
  let payload = item.json;
  if (Array.isArray(payload)) payload = payload[0];

  const clientes = (payload && payload.clientes) || [];
  for (const c of clientes) {
    if (!c.id) continue;

    idMap[c.id] = {
      nome: c.nome,
      dataCriacao: c.dataCriacao,
    };

    const key = normalize(c.nome);
    if (!key) continue;

    if (nameToId[key] && nameToId[key] !== c.id) {
      duplicates.push({
        level: 'warn',
        message: `Duplicate normalized name "${key}" — kept ${nameToId[key]}, ignored ${c.id} (${c.nome})`,
      });
    } else {
      nameToId[key] = c.id;
    }
  }
}

return [
  {
    json: {
      idMap,
      nameToId,
      duplicates,
      totalClientes: Object.keys(idMap).length,
    },
  },
];
