#!/usr/bin/env bash
# Configure Cloudflare Logpush → R2 for the production Workers API.
#
# Idempotent: re-running with the same config is a no-op (it diff-patches
# the existing job rather than creating a duplicate).
#
# Why this exists: pre-launch we have `wrangler tail` only — incident retro
# is bounded by the live tail window (a few minutes). After this script
# runs we have 30-day retention in R2 and queryable from there.
#
# Usage:
#   export CLOUDFLARE_API_TOKEN=...   # needs `Account / Logs Edit` + `Workers Scripts:Read`
#   export CLOUDFLARE_ACCOUNT_ID=...
#   export R2_BUCKET=atheon-logs      # defaults to atheon-logs
#   ./scripts/configure-logpush.sh
#
# What it does:
#   1. Verifies the R2 bucket exists (creates it if not)
#   2. Creates or updates a Logpush job that streams Worker request logs
#      to that bucket, partitioned by date hour: logs/dt=YYYY-MM-DD/hour=HH/
#   3. Enables the job
#
# Day-2: pair with a Sentry alert on >1% 5xx over 5 min (configured in Sentry,
# not here).

set -euo pipefail

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN (scopes: Account.Logs Edit + Workers Scripts:Read)}"
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"

WORKER_NAME="${WORKER_NAME:-atheon-api}"
R2_BUCKET="${R2_BUCKET:-atheon-logs}"
JOB_NAME="${JOB_NAME:-atheon-api-requests}"

API="https://api.cloudflare.com/client/v4"
H_AUTH="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
H_JSON="Content-Type: application/json"

echo "→ Ensuring R2 bucket: ${R2_BUCKET}"
BUCKET_GET=$(curl -sS -o /tmp/bucket.json -w '%{http_code}' \
  -H "$H_AUTH" \
  "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets/${R2_BUCKET}" || true)
if [ "$BUCKET_GET" = "404" ]; then
  echo "  bucket missing — creating"
  curl -sS -X POST -H "$H_AUTH" -H "$H_JSON" \
    "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/r2/buckets" \
    -d "{\"name\":\"${R2_BUCKET}\"}" > /tmp/bucket-create.json
  jq -e '.success == true' /tmp/bucket-create.json > /dev/null \
    || { echo "ERROR: bucket creation failed"; cat /tmp/bucket-create.json; exit 1; }
  echo "  ✓ bucket created"
else
  echo "  ✓ bucket exists (HTTP ${BUCKET_GET})"
fi

# Logpush destination format for R2:
#   r2://<bucket-name>/<prefix>?account-id=<id>&access-key-id=<key>&secret-access-key=<secret>
#
# We use IAM-style auth via R2 API tokens for now. If you generate dedicated
# R2 access keys, set R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY in the env;
# otherwise this script falls back to the global account API token (only
# works in some Cloudflare account configurations).
DEST_PREFIX="logs/dt={DATE}/hour={HOUR}/{TIME}-{IP}.log.gz"

if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  DEST_CONF="r2://${R2_BUCKET}/${DEST_PREFIX}?account-id=${CLOUDFLARE_ACCOUNT_ID}&access-key-id=${R2_ACCESS_KEY_ID}&secret-access-key=${R2_SECRET_ACCESS_KEY}"
else
  echo "WARN: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not set — using account-level token (works in most accounts but generate dedicated R2 creds for prod)"
  DEST_CONF="r2://${R2_BUCKET}/${DEST_PREFIX}?account-id=${CLOUDFLARE_ACCOUNT_ID}"
fi

# Logpush ownership challenge — Cloudflare requires you to prove you own the
# destination by uploading a token to a specific key. This is auto-handled
# when the destination is R2 in the same account (no challenge step needed).

echo "→ Listing existing Logpush jobs for this account"
curl -sS -H "$H_AUTH" \
  "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/logpush/jobs" > /tmp/jobs.json
EXISTING=$(jq -r --arg name "$JOB_NAME" \
  '.result[] | select(.name == $name) | .id' /tmp/jobs.json | head -1)

# Logs we capture: all Worker request fields useful for incident retro.
# Timestamps in ISO 8601 (RFC3339) for easy parquet conversion downstream.
LOGPULL_OPTIONS="fields=Event,EventTimestampMs,Outcome,RayID,Logs,ScriptName,Exceptions,DispatchNamespace,CPUTimeMs,WallTimeMs&timestamps=rfc3339"

read -r -d '' JOB_BODY <<JSON || true
{
  "name": "${JOB_NAME}",
  "logpull_options": "${LOGPULL_OPTIONS}",
  "destination_conf": "${DEST_CONF}",
  "dataset": "workers_trace_events",
  "enabled": true,
  "filter": "{\"where\":{\"key\":\"ScriptName\",\"operator\":\"eq\",\"value\":\"${WORKER_NAME}\"}}",
  "frequency": "high"
}
JSON

if [ -n "$EXISTING" ]; then
  echo "→ Updating existing Logpush job ${EXISTING}"
  curl -sS -X PUT -H "$H_AUTH" -H "$H_JSON" \
    "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/logpush/jobs/${EXISTING}" \
    -d "$JOB_BODY" > /tmp/job-update.json
  jq -e '.success == true' /tmp/job-update.json > /dev/null \
    || { echo "ERROR: job update failed"; cat /tmp/job-update.json; exit 1; }
  echo "  ✓ job updated"
else
  echo "→ Creating Logpush job ${JOB_NAME}"
  curl -sS -X POST -H "$H_AUTH" -H "$H_JSON" \
    "${API}/accounts/${CLOUDFLARE_ACCOUNT_ID}/logpush/jobs" \
    -d "$JOB_BODY" > /tmp/job-create.json
  jq -e '.success == true' /tmp/job-create.json > /dev/null \
    || { echo "ERROR: job create failed"; cat /tmp/job-create.json; exit 1; }
  echo "  ✓ job created"
fi

echo ""
echo "Done. Verify in 5–10 min: \`wrangler r2 object list ${R2_BUCKET} --prefix=logs/\`"
echo "Add an R2 lifecycle rule to expire \`logs/\` after 30 days (one-time, via Cloudflare dashboard)."
