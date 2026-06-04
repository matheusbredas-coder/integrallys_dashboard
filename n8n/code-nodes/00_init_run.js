// ─────────────────────────────────────────────────────────────────────────────
// Code node: "Init Run"
//
// Generates run metadata used throughout the workflow.
//
// Upstream: a Set node that injects { trigger, mode }
//   - trigger: "backfill" | "webhook" | "cron"
//   - mode:    "backfill" | "sync"
//
// Downstream consumers reference $('Init Run').first().json
// ─────────────────────────────────────────────────────────────────────────────

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const trigger = $json.trigger || 'backfill';
const mode = $json.mode || (trigger === 'backfill' ? 'backfill' : 'sync');

return [
  {
    json: {
      run_id: uuidv4(),
      started_at: new Date().toISOString(),
      trigger,
      mode,
    },
  },
];
