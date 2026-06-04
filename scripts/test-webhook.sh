#!/usr/bin/env bash
#
# test-webhook.sh — manually trigger the Gestek - Sync workflow via its webhook.
#
# Usage:
#   N8N_HOST=https://your-n8n.com  SYNC_TOKEN=xxx  ./scripts/test-webhook.sh
#
# Or set them in your shell first:
#   export N8N_HOST=https://your-n8n.com
#   export SYNC_TOKEN=xxx
#   ./scripts/test-webhook.sh

set -euo pipefail

: "${N8N_HOST:?Set N8N_HOST (e.g. https://your-n8n-host)}"
: "${SYNC_TOKEN:?Set SYNC_TOKEN (the X-Sync-Token credential value)}"

URL="${N8N_HOST%/}/webhook/gestek-sync"

echo "→ POST $URL"
echo ""

response=$(curl -sS -w "\n---\nHTTP %{http_code}\nTime: %{time_total}s\n" \
  -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "X-Sync-Token: $SYNC_TOKEN")

echo "$response"

# Optional: pretty-print the JSON body if `jq` is available
if command -v jq >/dev/null 2>&1; then
  echo ""
  echo "→ Parsed summary:"
  echo "$response" | sed -n '1,/^---$/p' | sed '/^---$/d' | jq '.' 2>/dev/null || true
fi
