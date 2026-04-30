# Atheon Operations Runbook

## 1. Deployment

### 1.1 API Worker (Cloudflare Workers)

```bash
# Deploy to production
cd workers/api
npx wrangler deploy --env production

# Deploy to staging
npx wrangler deploy --env staging
```

### 1.2 Frontend (Cloudflare Pages)

Frontend deploys automatically via GitHub Actions on push to `main`.

Manual deploy:
```bash
npm run build
npx wrangler pages deploy dist --project-name=atheon-33b
```

### 1.3 Rollback

```bash
# List recent deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback
```

## 2. Database Management (D1)

### 2.1 Run Migrations

Migrations run automatically on the first request after a `MIGRATION_VERSION` bump via the auto-migration middleware in `workers/api/src/index.ts`. Subsequent requests short-circuit on the `db:migrated:<version>` KV flag.

**Bounding contract** (added 2026-04-30 after the v56-stripe-checkout outage):
- The middleware races the migration against a 25-second hard timeout and takes a 60-second KV lease (`db:migrating:<version>`) so concurrent requests don't all attempt migration in parallel.
- On timeout: the version flag becomes `'timeout'`, all subsequent `/api/*` requests return 503 with `reason: 'timeout'` for 5 min until an operator runs migration manually.
- On unexpected error: the flag becomes `'error'` (same 5-min window).
- During an active lease: requests return 503 with `reason: 'migration_in_progress'`.

**Recovery — auto-migration timed out**:

```bash
# Trigger a manual migration via the admin endpoint (no time bound).
# X-Setup-Secret must match wrangler secret SETUP_SECRET.
curl -X POST https://atheon-api.vantax.co.za/api/v1/admin/migrate \
  -H "X-Setup-Secret: $(wrangler secret list | grep SETUP_SECRET | awk ...)"

# OR: if the migration's already known to have applied (column heals are
# idempotent and most are already there), unblock production by setting
# the version flag to 'true' directly:
npx wrangler kv key put "db:migrated:<version>" "true" \
  --binding CACHE --remote --ttl 86400
```

To force a migration bump, increment `MIGRATION_VERSION` in `workers/api/src/services/migrate.ts`. New schema goes in `columnsToHeal` (idempotent ALTER TABLE) for additive changes; full table creates go in the `coreTableSQL` block.

### 2.2 Manual Queries

```bash
# Production
npx wrangler d1 execute atheon-db --command "SELECT COUNT(*) FROM tenants"

# List tables
npx wrangler d1 execute atheon-db --command ".tables"
```

### 2.3 Backup

```bash
npx wrangler d1 backup create atheon-db
npx wrangler d1 backup list atheon-db
npx wrangler d1 backup download atheon-db <backup-id>
```

## 3. Tenant Management

### 3.1 Create New Tenant

`tenants.industry` was dropped from the schema (see migrate.ts `columnsToDrop`).
Including it in the INSERT will fail with `no such column: industry`.

```bash
npx wrangler d1 execute atheon-db --command \
  "INSERT INTO tenants (id, name, slug, status, plan, created_at) \
   VALUES ('$(uuidgen)', 'Company Name', 'company-slug', 'active', 'enterprise', datetime('now'))"
```

If you need industry classification for a tenant (e.g., for benchmarks),
record it elsewhere — `tenant_entitlements.catalyst_clusters` is the
closest existing signal. The aggregation crons (peer benchmarks,
resolution patterns) currently bucket every active tenant under
`'general'`; per-tenant industry tagging is on the Tier-2 backlog.

### 3.2 Disable Tenant

```bash
npx wrangler d1 execute atheon-db --command \
  "UPDATE tenants SET status = 'suspended' WHERE slug = 'company-slug'"
```

### 3.3 Reset Tenant Data

Use the API endpoint:
```bash
curl -X POST https://atheon-api.vantax.co.za/api/tenants/reset \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json"
```

## 4. Monitoring

### 4.1 Health Check

```bash
curl https://atheon-api.vantax.co.za/api/healthz
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "db": "connected",
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

### 4.2 Worker Logs

```bash
npx wrangler tail --format pretty
```

### 4.3 AI Cost Monitoring

```bash
curl https://atheon-api.vantax.co.za/api/ai-costs \
  -H "Authorization: Bearer <token>"
```

### 4.4 Key Metrics to Watch

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| API Latency (p95) | > 2s | > 5s |
| Error Rate | > 1% | > 5% |
| AI Cost (monthly) | > $50/tenant | > $100/tenant |
| D1 Row Count | > 500K | > 1M |
| Cache Hit Rate | < 50% | < 20% |

## 5. ERP Sync

### 5.1 Trigger Manual Sync

```bash
curl -X POST https://atheon-api.vantax.co.za/api/erp/sync \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"connectionId": "<connection-id>"}'
```

### 5.2 Check Sync Status

```bash
curl https://atheon-api.vantax.co.za/api/erp/connections \
  -H "Authorization: Bearer <token>"
```

### 5.3 Token Refresh Issues

If an ERP connection shows `token_expired`:
1. Check the connection config for valid `refresh_token`
2. Verify the ERP provider's OAuth app is still active
3. Invalidate the cached token and trigger a manual sync
4. If refresh fails, the user must re-authenticate via OAuth flow

## 6. Emergency Procedures

### 6.1 API Down

1. Check Cloudflare dashboard for Worker errors
2. Run `npx wrangler tail` to see live errors
3. Check D1 database connectivity
4. If needed, rollback: `npx wrangler rollback`

### 6.2 Database Corruption

1. Stop all writes: set `MAINTENANCE_MODE=true` in Worker secrets
2. Create a backup: `npx wrangler d1 backup create atheon-db`
3. Identify corrupted tables via `.schema` and `PRAGMA integrity_check`
4. Restore from last known good backup if needed

### 6.3 Security Incident

1. Rotate all secrets immediately:
   - `JWT_SECRET`
   - `ENCRYPTION_KEY`
   - `OLLAMA_API_KEY`
   - `MS_GRAPH_CLIENT_SECRET`
2. Invalidate all active sessions by changing `JWT_SECRET`
3. Review audit logs: `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100`
4. Check for unauthorized tenant access in logs
5. Notify affected users

### 6.4 AI Budget Exceeded

1. Check current spend: `GET /api/ai-costs/budget`
2. If critical, flush cache: `POST /api/ai-costs/cache/flush`
3. Review query patterns for abuse
4. Adjust per-tenant budget limits in KV

## 7. Secrets Reference

| Secret | Purpose | Rotation Frequency |
|--------|---------|-------------------|
| `JWT_SECRET` | Auth token signing | Quarterly |
| `ENCRYPTION_KEY` | ERP credential encryption | Annually |
| `OLLAMA_API_KEY` | Ollama Cloud AI access | As needed |
| `MS_GRAPH_CLIENT_ID` | Microsoft Graph email | Annually |
| `MS_GRAPH_CLIENT_SECRET` | Microsoft Graph email | Annually |
| `MS_GRAPH_TENANT_ID` | Microsoft Graph tenant | Static |

## 8. KV Namespaces

| Namespace | Purpose | TTL |
|-----------|---------|-----|
| `CACHE` | AI response cache, rate limits, tokens | Varies (5min–24hr) |

## 9. Cron Schedule

Configured in `wrangler.toml`:

| Schedule | Task |
|----------|------|
| Every 15 minutes | Health recalculation, briefings, memory sync, process mining |
| Every 15 minutes | Agent lifecycle checks, sub-catalyst execution |
| Every 15 minutes | Email queue processing with retry |

## 10. Password Reset — Operator Procedures

### 10.1 Normal flow (email delivery working)

```bash
curl -X POST https://atheon-api.vantax.co.za/api/v1/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com"}'
```

Response is always `{"ok":true}` — no account enumeration. User receives a magic link valid for 1 hour.

### 10.2 KV bypass (email delivery broken or urgent)

When MS Graph is misconfigured or a user must regain access before email is fixed, write a reset token directly to the `CACHE` KV namespace.

```bash
# 1. Generate a token
TOKEN=$(openssl rand -hex 32)

# 2. Look up user_id
npx wrangler d1 execute atheon-db --remote \
  --command "SELECT id FROM users WHERE email = 'user@example.com'"

# 3. Write token to CACHE KV (1 hour TTL)
npx wrangler kv key put \
  --binding=CACHE \
  --remote \
  "pwreset:$TOKEN" \
  "<user-id>" \
  --ttl 3600

# 4. Hand the operator URL to the user via a secure channel:
echo "https://atheon-33b.pages.dev/reset-password?token=$TOKEN"
```

**Caveats:**
- The token is single-use; consuming it deletes the KV entry.
- Never log the token or email it through an insecure channel.
- Prefer fixing the underlying email issue (§11) over repeated bypasses.

## 11. Email — MS Graph Diagnostics

### 11.1 Symptom: `/forgot-password` hangs ~45s

Root cause is almost always `MS_GRAPH_TENANT_ID` set to a placeholder like `test` — Azure AD answers slowly for invalid tenants. The PR #255 fix caps the MS Graph token fetch at 5s (`AbortSignal.timeout`) and runs `sendOrQueueEmail` via `c.executionCtx.waitUntil()` so the HTTP response is not blocked. If a hang returns, check the secrets:

```bash
cd workers/api
npx wrangler secret list --env production | grep MS_GRAPH
```

All three must be set to real values:
- `MS_GRAPH_TENANT_ID` — the Azure AD tenant UUID, not `test`
- `MS_GRAPH_CLIENT_ID`
- `MS_GRAPH_CLIENT_SECRET`

### 11.2 Repair

```bash
cd workers/api
npx wrangler secret put MS_GRAPH_TENANT_ID --env production
# Paste the real tenant ID when prompted
```

Verify by watching logs as a test `forgot-password` is triggered:

```bash
npx wrangler tail --format pretty
```

Expected log line: `Email dispatched via Graph to …`. Any `AbortError` or `Invalid tenant` means the secret is still wrong.

### 11.3 Failed email queue

If MS Graph is temporarily down, failed sends are queued in the `email_queue` table and retried by the cron every 15 minutes.

```bash
# Inspect the queue depth
npx wrangler d1 execute atheon-db --remote \
  --command "SELECT status, COUNT(*) FROM email_queue GROUP BY status"

# Force a retry (via the cron handler) or manually re-drive:
curl -X POST https://atheon-api.vantax.co.za/api/v1/admin/email/retry \
  -H "Authorization: Bearer <admin-token>"
```

## 12. Encryption Key Rotation

ERP credentials are encrypted at rest with `ENCRYPTION_KEY`. Rotate via the double-write endpoint (PR #223) — never swap the secret in-place.

```bash
# 1. Mint and set the NEW key as ENCRYPTION_KEY_NEXT
NEW_KEY=$(openssl rand -hex 32)
cd workers/api
echo "$NEW_KEY" | npx wrangler secret put ENCRYPTION_KEY_NEXT --env production

# 2. Trigger re-encryption (reads each ciphertext with current key, writes with NEXT)
curl -X POST https://atheon-api.vantax.co.za/api/v1/admin/rotate-encryption \
  -H "Authorization: Bearer <super-admin-token>"

# 3. Promote: move NEXT → ENCRYPTION_KEY, clear NEXT
echo "$NEW_KEY" | npx wrangler secret put ENCRYPTION_KEY --env production
npx wrangler secret delete ENCRYPTION_KEY_NEXT --env production
```

After promotion, sample a handful of ERP connections to confirm decryption still works:

```bash
curl https://atheon-api.vantax.co.za/api/v1/erp/connections \
  -H "Authorization: Bearer <admin-token>" | jq '.[0]'
```

## 13. LLM Budget & 429 Diagnostics

### 13.1 Symptom: users see `429 budget_exhausted`

Per-tenant daily LLM spend is capped in `tenant_llm_budget`. Current usage is aggregated into `tenant_llm_usage`.

```bash
# Daily spend for a tenant
npx wrangler d1 execute atheon-db --remote \
  --command "SELECT day, tokens_in, tokens_out, cost_usd FROM tenant_llm_usage \
             WHERE tenant_id = '<tid>' ORDER BY day DESC LIMIT 7"

# Budget
npx wrangler d1 execute atheon-db --remote \
  --command "SELECT * FROM tenant_llm_budget WHERE tenant_id = '<tid>'"
```

### 13.2 Raise a budget temporarily

```bash
npx wrangler d1 execute atheon-db --remote \
  --command "UPDATE tenant_llm_budget SET daily_usd_limit = 50 WHERE tenant_id = '<tid>'"
```

Flush the cached budget check so the new limit applies immediately:

```bash
npx wrangler kv key delete --binding=CACHE --remote "llm_budget:<tid>"
```

## 14. Webhook Delivery Failures

Webhooks are signed with HMAC-SHA256 using a per-webhook secret. Delivery attempts are recorded in `webhook_deliveries`.

### 14.1 Inspect recent failures

```bash
npx wrangler d1 execute atheon-db --remote \
  --command "SELECT webhook_id, status_code, error, created_at \
             FROM webhook_deliveries \
             WHERE status != 'delivered' \
             ORDER BY created_at DESC LIMIT 20"
```

### 14.2 Common causes

- **401/403**: consumer rejects the signature. Re-issue the secret via the UI (secret is shown once) and update the consumer.
- **Timeout**: consumer endpoint > 10s. Coordinate with consumer owner; Atheon will retry with exponential backoff up to 5 attempts.
- **DNS failure**: typo in webhook URL. Update via `PATCH /api/v1/webhooks/:id`.

### 14.3 Manual redelivery

```bash
curl -X POST https://atheon-api.vantax.co.za/api/v1/webhooks/<id>/redeliver/<delivery-id> \
  -H "Authorization: Bearer <admin-token>"
```

## 15. Secret Rotation Drill (after credential leak)

If any of `JWT_SECRET`, `ENCRYPTION_KEY`, or a Cloudflare/GitHub token is leaked:

1. **Rotate GitHub PAT**: revoke at https://github.com/settings/tokens, mint new, update any CI secrets.
2. **Rotate Cloudflare Global API Key**: https://dash.cloudflare.com/profile/api-tokens — regenerate. Update any deploy pipelines.
3. **Rotate `JWT_SECRET`**: this invalidates every active session.
   ```bash
   cd workers/api
   openssl rand -hex 64 | npx wrangler secret put JWT_SECRET --env production
   ```
4. **Rotate `ENCRYPTION_KEY`**: follow §12 (double-write, never in-place).
5. **Notify users** that they must re-login; MFA state is preserved.
6. **Audit log sweep** for any unauthorized admin actions during the exposure window:
   ```bash
   npx wrangler d1 execute atheon-db --remote \
     --command "SELECT * FROM audit_log WHERE created_at > '<leak-start>' \
                AND action LIKE 'admin.%' ORDER BY created_at DESC"
   ```
