// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Build Run Summary"
//
// Final node before "Respond to Webhook" + "Update Sync Log Row". Aggregates
// counts from all the upstream Code nodes into one summary JSON.
//
// Upstream:
//   $('Init Run').first().json              → { run_id, started_at, trigger, mode }
//   $('Split Patients').first().json         → { ..., duplicates, orphanSupabasePatients }
//   $('Aggregate Sales').first().json        → { totalSalesAggregated }
//   $('Build Update Payload').first().json   → { rowCount, unmatchedSales }
//   $('Generate Monthly Windows').all().length → window count
//
// Output (single item):
//   { json: { summary, warnings, completed_at } }
// ─────────────────────────────────────────────────────────────────────────────

const init = $('Init Run').first().json;
const split = $('Split Patients').first().json;
const aggregate = $('Aggregate Sales').first().json;
const payload = $('Build Update Payload').first().json;
const windowCount = $('Generate Monthly Windows').all().length;

const completed_at = new Date().toISOString();

const summary = {
  run_id: init.run_id,
  started_at: init.started_at,
  completed_at,
  trigger: init.trigger,
  mode: init.mode,
  patients_updated: payload.rowCount,
  new_patients_inserted: init.mode === 'sync' ? split.newGestekClients.length : 0,
  unmatched_sales: payload.unmatchedSales.length,
  duplicate_name_warnings: (split.duplicates || []).length,
  orphan_supabase_patients: split.orphanSupabasePatients.length,
  monthly_windows_processed: windowCount,
  total_sales_aggregated: aggregate.totalSalesAggregated,
};

const warnings = [
  ...(split.duplicates || []),
  ...split.orphanSupabasePatients.map((p) => ({
    level: 'warn',
    message: `Supabase patient "${p.Nome}" (id=${p.id}) has no matching Gestek client — Gestek may have deleted them`,
  })),
  ...payload.unmatchedSales.map((s) => ({
    level: 'warn',
    message: `Sales for unknown clienteId ${s.clienteId} (${s.sale_count} sales)`,
  })),
];

return [{ json: { summary, warnings, completed_at } }];
