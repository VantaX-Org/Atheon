# Atheon Hybrid / On-Premise Deploy

Atheon supports three deployment models. The Atheon Worker API code is **the
same in all three** — what differs is which control plane provides the
license, where data lives, and who operates the runtime.

| Model | Workers run | Data resides | License managed by | Use when |
|---|---|---|---|---|
| **saas** | Atheon Cloudflare | Atheon Cloudflare D1 + R2 | Atheon (implicit) | Default. Lowest TCO. |
| **hybrid** | Customer infra (Docker / k8s) + Atheon Cloudflare for control plane | Customer Postgres + MinIO | Atheon cloud (phone home) | Customer wants their own data plane but doesn't want to operate billing/license/version themselves |
| **on-premise** | Customer infra | Customer Postgres + MinIO | Atheon cloud (phone home) | Air-gapped or strict residency requirements; same as hybrid but customer optionally disables phone-home |

Hybrid and on-premise share the same docker-compose and the same code path —
the differentiator is the contract (and pricing).

## Architecture (hybrid)

```
                                ┌──────────────────────────────┐
   end-user browser  ──────────▶│  Customer's Atheon API       │
                                │  (docker-compose / k8s)      │
                                │  • Postgres                  │
                                │  • Ollama Cloud / local LLM  │
                                │  • MinIO (R2-compatible)     │
                                │  • DEPLOYMENT_ROLE=customer  │
                                └──────────────────────────────┘
                                          │
                                          │  GET /api/agent/license-check (hourly)
                                          ▼
                                ┌──────────────────────────────┐
                                │  Atheon Cloud                │
                                │  • managed_deployments       │
                                │  • license + version control │
                                │  • billing / revenue tracking│
                                └──────────────────────────────┘
```

End users connect **directly to the customer's Atheon API**. Atheon's cloud
is invisible to them — its only role is license validation, version
management, and billing telemetry. Catalyst execution, ERP integration,
mind queries, and assessment runs all happen inside the customer's VPC
against the customer's data.

## Deployment flow

1. **License is provisioned** in Atheon cloud:

   ```bash
   curl -X POST https://atheon-api.vantax.co.za/api/v1/deployments \
     -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
     -d '{
       "tenant_id": "customer-corp",
       "name": "CustomerCorp Production",
       "deployment_type": "hybrid",
       "licence_expires_at": "2027-04-28T00:00:00Z"
     }'
   # → returns { id, licence_key }
   ```

2. **Customer receives** a `.env` with the licence key, the customer-specific
   tenant id, and an `install.sh` URL pointing at the right docker-compose.

3. **Customer runs** `docker-compose up`:

   - `api` service: Atheon Worker code (same image as cloud), starts with
     `DEPLOYMENT_ROLE=customer`, `LICENCE_KEY=<key>`, `ATHEON_LICENSE_CHECK_URL=https://atheon-api.vantax.co.za/api/agent/license-check`
   - `agent` service: heartbeat sidecar that reports health, applies config
     pushes, and triggers self-update on `targetVersion` changes
   - `db`: Postgres
   - `redis`, `ollama`, `minio`: data-plane infrastructure

4. **License enforcement engages**: every request the customer's Worker
   handles passes through `licenseEnforcement()` middleware
   ([workers/api/src/services/license-enforcement.ts](../workers/api/src/services/license-enforcement.ts)).
   On the first hour, it phones home to validate the license and caches the
   verdict in KV.

5. **Subsequent requests** read the cached verdict (1-hour TTL). On cache
   miss or > 1-hour age, the middleware re-phones home. Network failures
   fail-OPEN against the cached value; long-running disconnection (>7 days)
   fails-CLOSED for safety.

## Configuration matrix

| Env var | Cloud (Atheon SaaS) | Hybrid (Customer) | On-premise (air-gapped) |
|---|---|---|---|
| `ENVIRONMENT` | `production` | `on-premise` | `on-premise` |
| `DEPLOYMENT_ROLE` | `cloud` | `customer` | `customer` (optional) |
| `LICENCE_KEY` | unset | provisioned via cloud | provisioned via cloud |
| `ATHEON_LICENSE_CHECK_URL` | unset | `https://atheon-api.vantax.co.za/api/agent/license-check` | unset OR set to internal mirror |
| `JWT_SECRET` | Cloudflare secret | Customer-managed (per-deploy) | Customer-managed |
| `ENCRYPTION_KEY` | Cloudflare secret | Customer-managed | Customer-managed |

If `DEPLOYMENT_ROLE` is unset OR not `'customer'`, the license-enforcement
middleware no-ops — useful for development and for fully air-gapped
on-premise deployments that don't want phone-home.

## Operating the customer instance

### Healthcheck

The customer instance exposes the same health endpoint as the cloud:

```bash
curl http://localhost:3000/healthz
```

Returns `{ status: "ok" }` regardless of license state — health is about
the runtime, not entitlement. The license endpoint below is the entitlement
check.

### License status

A read-only admin endpoint surfaces the current cached license verdict
without making a phone-home call:

```bash
curl http://localhost:3000/api/v1/license-status
# → { "valid": true, "status": "active", "expires_at": "2027-04-28...",
#     "last_checked_at": "2026-04-28T15:00:00.000Z", "reason": "" }
```

### Force re-validate (after fixing connectivity, after license renewal)

```bash
curl -X POST http://localhost:3000/api/v1/license-status/refresh
```

This bypasses the 1-hour cache and triggers an immediate phone-home. Returns
the fresh verdict.

### Failure modes

| Scenario | Behaviour |
|---|---|
| License is active, network OK | All requests succeed |
| Phone-home returns 200 with `valid: false` (revoked / expired) | Data-plane requests return **HTTP 503** with the reason; healthz + license-status remain accessible |
| Phone-home returns network error (single transient) | Last good cached verdict is used; logged for ops |
| Phone-home returns network error for > 7 days | Middleware fails-CLOSED — data-plane returns 503 with a remediation message pointing at `ATHEON_LICENSE_CHECK_URL` |
| `LICENCE_KEY` or `ATHEON_LICENSE_CHECK_URL` missing on a customer instance | Middleware logs a warning and allows traffic (fail-OPEN) so the customer doesn't lock themselves out while fixing config |

### Recovery procedure

If a customer's instance is unable to phone home (firewall, expired
certificate on Atheon side, DNS issue):

1. Verify the customer can reach `ATHEON_LICENSE_CHECK_URL` from inside
   their VPC: `curl ${ATHEON_LICENSE_CHECK_URL}?key=test` should return a
   JSON body (even if `valid: false` for an unknown key, the connectivity
   itself is what matters).
2. Once connectivity is restored, force re-validation:
   `POST /api/v1/license-status/refresh`.
3. License status should flip back to `active` immediately.

## Cloud-side license control

To revoke or renew a customer's license, update `managed_deployments` on
Atheon's cloud database — no customer-side action required:

```bash
# Suspend
npx wrangler d1 execute atheon-db --remote --command \
  "UPDATE managed_deployments SET status = 'suspended' WHERE licence_key = '<key>'"

# Renew (extend expiry)
npx wrangler d1 execute atheon-db --remote --command \
  "UPDATE managed_deployments SET licence_expires_at = '2028-04-28T00:00:00Z', status = 'active' WHERE licence_key = '<key>'"
```

The customer's instance picks up the new state on its next phone-home (max
1 hour later, or immediately if the customer admin runs the refresh
endpoint).

## Pricing model

Per `assessment-engine.ts::DEFAULT_ASSESSMENT_CONFIG`:

| Model | Annual licence fee (ZAR) |
|---|---|
| saas | ~R 5,400 / user / year (R 450 / user / month) |
| hybrid | R 180,000 / year flat |
| on-premise | R 360,000 / year flat (includes 24/7 support) |

The fee is encoded in the assessment engine for ROI calculations. Hybrid
sits between SaaS and full on-premise — customer keeps their data, Atheon
keeps the operational burden of managing license and version cycles.

## Implementation status

Per the [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md):

- [x] License-enforcement middleware (`licenseEnforcement()`)
- [x] Cloud-side phone-home endpoint (`GET /api/agent/license-check`)
- [x] Customer-side admin endpoints (`/api/v1/license-status`, `.../refresh`)
- [x] Wrangler / docker-compose configuration
- [x] Test coverage (7 integration tests)
- [x] This documentation

What's deliberately **not** in this design:

- Cross-customer request routing from the cloud back into customer infra.
  Customers' end-users connect to the customer's API directly; the cloud is
  invisible to end-user traffic. This eliminates an entire class of cross-
  tenant data-leak risk.
- Customer-side tenant isolation across customers. Each customer's
  docker-compose is a single-tenant deployment by design.
