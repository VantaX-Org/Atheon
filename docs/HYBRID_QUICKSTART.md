# Atheon Hybrid Quickstart

**Audience:** customer-side platform engineer. Goal: get Atheon running in your VPC in 30 minutes.

This is the install path for the **hybrid** deployment model — your data plane runs in your environment, Atheon's cloud handles license + version + billing only. For full architecture see [HYBRID_DEPLOY.md](HYBRID_DEPLOY.md).

---

## Prerequisites

- **Compute:** Linux host with Docker 24+ and Docker Compose v2. 4 vCPU / 8GB RAM minimum for first 5 tenants.
- **Storage:** 50GB SSD for the Postgres + MinIO containers.
- **Outbound network:** TCP/443 to `atheon-api.vantax.co.za` (license check) and `ghcr.io` (image pulls). No inbound from internet required.
- **Provisioning packet** from Atheon ops, containing:
  - `ATHEON_DEPLOYMENT_ID` — your unique deployment id
  - `ATHEON_LICENCE_KEY` — your license key (treat as a secret)
  - `ATHEON_API_TAG` — the version tag to pin (e.g. `2026.04`)

---

## 1. Pull the deploy bundle

```bash
git clone --depth=1 https://github.com/VantaX-Org/Atheon-deploy.git atheon
cd atheon
```

If the deploy repo is private to your account, the provisioning packet contains a deploy key — drop it into `~/.ssh/atheon-deploy.key` and use:

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/atheon-deploy.key" \
  git clone git@github.com:VantaX-Org/Atheon-deploy.git atheon
```

## 2. Configure secrets

Create `.env` from the template:

```bash
cp .env.example .env
```

Edit `.env` and fill in **only** the values from your provisioning packet — leave everything else as the defaults:

```ini
ATHEON_DEPLOYMENT_ID=<your-id>
ATHEON_LICENCE_KEY=<your-key>
ATHEON_API_TAG=2026.04                  # pinned version
ATHEON_LICENSE_CHECK_URL=https://atheon-api.vantax.co.za/api/agent/license-check
DEPLOYMENT_ROLE=customer

# Generate fresh secrets — do NOT reuse from any other deployment
JWT_SECRET=<openssl rand -hex 32>
ENCRYPTION_KEY=<openssl rand -hex 32>

# Database — change for production
DATABASE_URL=postgresql://atheon:<strong-password>@db:5432/atheon
```

> **Important:** `JWT_SECRET` and `ENCRYPTION_KEY` are environment-local. If you rotate them, every existing user must re-authenticate and every encrypted ERP credential must be re-entered.

## 3. Start

```bash
docker compose up -d
```

Wait ~60 seconds for the first-boot migration to complete, then check health:

```bash
curl -fsSL http://localhost:3000/healthz | jq .
```

Expected response:

```json
{
  "status": "healthy",
  "checks": { "database": { "status": "ok" }, "cache": { "status": "ok" } }
}
```

## 4. Verify license phone-home

```bash
curl -fsSL http://localhost:3000/api/v1/license-status | jq .
```

Expected: `"status": "active"` with a recent `last_checked_at`. The Worker phones home every hour; if `last_checked_at` is older than 7 days, all data-plane traffic is blocked with HTTP 503.

If `status: "unknown"` or 5xx, check:
- Outbound TCP/443 to `atheon-api.vantax.co.za` is open
- `ATHEON_LICENCE_KEY` matches the key in your provisioning packet
- `ATHEON_LICENSE_CHECK_URL` is the cloud URL, not your local one

## 5. Initial admin user

```bash
docker compose exec api node /app/scripts/create-admin-user.js \
  --email you@yourcompany.com \
  --name "Your Name" \
  --tenant-name "Your Company"
```

Open `http://localhost:3000` (or whatever URL you've fronted with TLS) and log in with the temporary password printed by the command above. You'll be prompted to set a permanent one and enrol MFA.

## 6. Connect your ERP

Inside the app:

1. Go to **Integrations** → **Add Connection**
2. Pick your ERP type (SAP / Odoo / Xero / NetSuite / generic CSV)
3. Enter credentials. They're encrypted with `ENCRYPTION_KEY` before persistence.
4. Click **Test Connection**. If green, click **Save**.

The first ingestion runs in the background. Check **Connection Health** in the page header to confirm rows are landing.

## 7. Run the smoke checklist

Before handing off to your end users, run through:

- [ ] `/healthz` returns 200
- [ ] `/api/v1/license-status` returns `active`
- [ ] `/api/v1/openapi.json` returns the API spec (developer-facing surface)
- [ ] Logged in as the admin you created
- [ ] MFA enrolled (`/settings/mfa`)
- [ ] One ERP connection in green state with non-zero row counts
- [ ] One assessment run from `/assessments` → Findings tab populated

If all seven boxes are checked, the deployment is ready for end users. Loop in your Atheon CS engineer for the kickoff call.

---

## Day-2 operations

| Task | Command |
|---|---|
| Tail logs | `docker compose logs -f api` |
| Backup database | `docker compose exec db pg_dump -U atheon atheon > atheon-$(date +%F).sql` |
| Restore database | `cat atheon-2026-04-01.sql \| docker compose exec -T db psql -U atheon atheon` |
| Update to a new version tag | edit `ATHEON_API_TAG` in `.env`, run `docker compose pull && docker compose up -d` |
| Rotate secrets | edit `.env`, run `docker compose up -d` (existing sessions invalidate) |

For the full operations runbook see [runbook.md](runbook.md).

---

## Troubleshooting

**`docker compose up` fails with `permission denied`:** check the deploy key has `chmod 600` and is registered with GitHub for the `Atheon-deploy` repo.

**Login fails with "Session expired":** check `JWT_SECRET` matches across all containers (it should — Compose injects from `.env`). If you've rotated, every user must re-log in.

**ERP fetch returns 0 rows:** check the ERP credentials are correct and the **service account** has read access to the relevant tables. Atheon never writes to your ERP unless you've explicitly enabled a Mutation-tier catalyst.

**License status shows `unknown` for >24 hours:** check outbound TCP/443 to `atheon-api.vantax.co.za`. If your network blocks SaaS calls, contact Atheon ops for an offline license file (covers up to 30 days).

**Pre-flight `pg_isready` succeeds but `/healthz` reports `database` `error`:** ensure `DATABASE_URL` is reachable from the API container, not just from the host. `db` is the Compose service name; if you've renamed it, update `DATABASE_URL` accordingly.

---

## Support

- **Production-down (P0):** the on-call number in your provisioning packet
- **Non-critical (P1+):** file a ticket at `/support-tickets` inside the app, or email `support@vantax.co.za`
- **Documentation:** [runbook.md](runbook.md), [HYBRID_DEPLOY.md](HYBRID_DEPLOY.md), [GO_LIVE_SPRINT.md](GO_LIVE_SPRINT.md)
