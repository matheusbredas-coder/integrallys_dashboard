// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Split Patients"
//
// Categorizes Supabase Clientes vs Gestek clientes into 3 buckets so the
// downstream nodes know what to INSERT / skip.
//
// Matching is by id only — public."Clientes".id IS the Gestek client ID.
// No name normalization is involved here.
//
// Upstream:
//   $('Build Clientes Map').first().json     → { idMap, duplicates, ... }
//   $('Read Supabase Patients').all()        → array of Clientes rows
//
// Output (single item):
//   {
//     existingIds:              [id, ...],                       // in Supabase
//     newGestekClients:         [{ id, nome, dataCriacao }],     // sync mode INSERTs these
//     orphanSupabasePatients:   [{ id, Nome }],                  // in Supabase but not in Gestek
//     duplicates: [...]                                          // passthrough warnings
//   }
// ─────────────────────────────────────────────────────────────────────────────

const clientesData = $('Build Clientes Map').first().json;
const { idMap, duplicates } = clientesData;

const supabasePatients = $('Read Supabase Patients').all().map((i) => i.json);

const supabaseIdSet = new Set();
const orphanSupabasePatients = [];

for (const p of supabasePatients) {
  if (!p.id) continue;
  supabaseIdSet.add(p.id);
  if (!idMap[p.id]) {
    orphanSupabasePatients.push({ id: p.id, Nome: p.Nome });
  }
}

const newGestekClients = [];
for (const [id, info] of Object.entries(idMap)) {
  if (!supabaseIdSet.has(id)) {
    newGestekClients.push({
      id,
      nome: info.nome,
      dataCriacao: info.dataCriacao,
    });
  }
}

return [
  {
    json: {
      existingIds: Array.from(supabaseIdSet),
      newGestekClients,
      orphanSupabasePatients,
      duplicates: duplicates || [],
    },
  },
];
