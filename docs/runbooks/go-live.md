# Go-Live Verification Runbook

The go-live gate is a set of suites that run against the **deployed** API (and a
local-only D1 restore target). They prove the things a demo or a unit test
cannot: that the live tenant reconciles correctly, that tenant isolation holds,
that roles are enforced, that the API survives concurrent load, and that the
database can actually be restored from a backup.

Run every gate green before promoting a production deploy.

## Prerequisites

### Credentials (never hardcoded)

The suites read credentials from the environment. The seeded vantax users are
provisioned out-of-band, so supply them via CI secrets or your shell — never
commit them.

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `VERIFY_ADMIN_EMAIL` | yes | — | all API suites (admin login) |
| `VERIFY_ADMIN_PASSWORD` | yes | — | all API suites |
| `VERIFY_API_URL` | no | `https://atheon-api.vantax.co.za` | all API suites |
| `VERIFY_APP_URL` | no | `https://atheon.vantax.co.za` | E2E traceability |
| `VERIFY_TENANT_SLUG` | no | `vantax` | login |
| `VERIFY_D1_DB` | no | `atheon-db` | accuracy, DR drill |
| `VERIFY_DEMO_SECRET` | no* | — | login (preferred MFA bypass) |
| `VERIFY_ADMIN_TOTP_SEED` | no* | — | login (real MFA completion) |

> **\*Mandatory MFA (v40).** The admin account is admin-tier, so once its 14-day
> MFA grace expires a bare `VERIFY_ADMIN_PASSWORD` login returns **403** and the
> gate fails with `Login forbidden (403) … mandatory MFA is enforced`. This is
> the control working as designed — do **not** weaken it to make the gate pass.
> Supply ONE of these instead (`ApiClient.login` picks the first present):
>
> - **`VERIFY_DEMO_SECRET`** — the `X-Demo-Secret` for the `POST
>   /api/v1/auth/demo-login` automation path. Must equal that environment's
>   `DEMO_LOGIN_SECRET` worker secret. Preferred for **staging** because it needs
>   no MFA state on the account. **Disabled when `ENVIRONMENT=production`**, so a
>   production gate cannot use it.
> - **`VERIFY_ADMIN_TOTP_SEED`** — the base32 authenticator seed for the admin
>   account when it has MFA enrolled. The gate runs the real `login →
>   /api/v1/auth/mfa/validate` challenge with a generated TOTP, exactly as a
>   human admin would. Use this for the **production** gate. Same value the
>   browser E2E suite reads as `E2E_*_LOGIN_TOTP_SEED` — enrol MFA once, set both.
>
> Operator one-time setup: (1) enrol an authenticator on the gate's admin
> account; (2) store its base32 seed as the `VERIFY_ADMIN_TOTP_SEED` (and
> matching `E2E_*_LOGIN_TOTP_SEED`) secret in the relevant GitHub environment;
> OR for staging only, set the `DEMO_LOGIN_SECRET` worker secret and the
> matching `VERIFY_DEMO_SECRET` GitHub secret. Never commit either value.

The DR drill additionally needs **wrangler auth**: either
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (CI) or a stored `wrangler
login` OAuth session (local). This is the same auth the accuracy suite's D1
queries already rely on.

### Load gate tuning (optional)

| Variable | Default | Meaning |
| --- | --- | --- |
| `LOAD_CONCURRENCY` | `5` | concurrent virtual users |
| `LOAD_DURATION` | `20` | test duration, seconds |
| `LOAD_ERROR_THRESHOLD_PCT` | `5` | max error rate before FAIL |
| `LOAD_P99_THRESHOLD_MS` | `5000` | max p99 latency before FAIL |

> The login endpoint runs bcrypt and dominates p99 (~3.5–4s observed). Keep
> `LOAD_P99_THRESHOLD_MS` ≥ 5000 unless login cost changes, or the gate will
> flap on a healthy API.

## The gates

| Gate | Command | Proves | Approx runtime |
| --- | --- | --- | --- |
| Accuracy | `npm run verify:accuracy` | Reseeds vantax, executes the 4 reconciliation catalysts, asserts reconciliation accuracy + the billing traceability invariant against live D1. | ~13 min cold |
| Isolation | `npm run verify:isolation` | A vantax admin cannot read foreign rows by id (IDOR → 403/404) and a `?tenant_id` override leaks no foreign data. | ~20 s |
| RBAC | `npm run verify:rbac` | Mints a user per role; verifies universal read, executive-only catalyst execute, admin-only user create, admin-gated audit-log read. | ~1 min |
| Load | `npm run verify:load` | API stays within the error-rate and p99 budget under concurrent load. | profile-dependent (~20 s default) |
| DR | `npm run verify:dr` | Remote D1 exports, restores into a clean local DB, every table returns non-empty, and the 6 business-critical tables reconcile exactly. | ~1–2 min |
| All matrices | `npm run verify:matrices` | Runs every vitest verification suite (accuracy + isolation + rbac) in one pass. | ~13 min cold |

### Fast iteration

`verify:accuracy`'s `globalSetup` reseeds the tenant (~220 s) and executes the 4
catalysts (~290 s) on every run. To iterate on assertions without paying that
cost, set `VERIFY_REUSE_RUNS=1` — if a `.run-manifest.json` already exists the
setup is skipped and the suites reuse the recorded runs. The isolation and RBAC
suites do not need fresh runs, so always run them with `VERIFY_REUSE_RUNS=1`.

```sh
export VERIFY_ADMIN_EMAIL=...        # seeded vantax admin
export VERIFY_ADMIN_PASSWORD=...
VERIFY_REUSE_RUNS=1 npm run verify:isolation
VERIFY_REUSE_RUNS=1 npm run verify:rbac
```

### Recommended order

1. `verify:accuracy` (cold — seeds the tenant the other suites read).
2. `verify:isolation` and `verify:rbac` with `VERIFY_REUSE_RUNS=1`.
3. `verify:load`.
4. `verify:dr`.

## The business value report

The seeded `va-demo` assessment carries a `businessReportKey` of
`assessments/va-demo-vantax/value-report.pdf`. `GET
/api/v1/assessments/va-demo-vantax/report/business` serves that artifact as a
**PDF** (`%PDF` magic bytes), regenerating it on demand if the object is
missing. The accuracy suite asserts the key is populated and the endpoint
serves a real PDF.

## Operational gotchas (learned the hard way)

- **Cloudflare WAF blocks the `Python-urllib` User-Agent** with HTTP 403 "error
  code: 1010". Ad-hoc Python probes must set a browser/curl `User-Agent` header.
  Node's `fetch` and `curl` are not blocked, so the suites (Node) are unaffected.
- **Local dev → prod API is CORS-blocked.** A browser on `localhost:5173`
  cannot call the prod API. This only affects browser-based E2E; all
  Node/curl/wrangler calls are unaffected. Run E2E against the deployed,
  same-origin frontend (`VERIFY_APP_URL`).
- **A stray `wrangler.jsonc` shadows `workers/api/wrangler.toml`.** The SPA's
  root config has no D1 binding, which breaks `wrangler ... --local`. The DR
  drill pins `--config wrangler.toml` to avoid this; do the same for any manual
  local D1 command run from `workers/api`.
- **D1 enforces a per-query CPU limit (error 7429).** `COUNT(*)` over large
  append-only tables (chat, ERP mirrors) can trip it. The DR drill counts only
  the small critical tables remotely and takes full counts from the restored
  local copy.
- **The DR drill destroys LOCAL D1 state** (ephemeral, gitignored
  `.wrangler/`). It never mutates production — the remote export is read-only.

## Known scope gaps

- **Cross-tenant read proof is partial.** With only vantax-admin credentials the
  isolation suite proves IDOR refusal and that the `?tenant_id` override is
  ignored. It does **not** prove that tenant B's rows are withheld from a
  tenant-A caller, because there is no second seeded tenant to read. The full
  proof needs a superadmin-seeded tenant B (`VERIFY_SUPERADMIN_EMAIL` /
  `VERIFY_SUPERADMIN_PASSWORD`, reserved in `verification/config.ts`).
- **E2E traceability requires same-origin.** Because of the CORS constraint
  above, the E2E spec must target the deployed frontend, not a local dev server
  pointed at prod.
- **Staging environment is partially rebuilt.** `wrangler.toml` now declares
  the `staging.atheon-api.vantax.co.za/*` route binding under
  `[env.staging]`, and `staging-e2e.yml` is back in `.github/workflows/` as
  a workflow_dispatch job gated on the `E2E_STAGING_*` secrets being present
  (it self-skips with a clear summary message until they exist). Production
  E2E (`production-e2e.yml`, 02:30 UTC daily) remains the authoritative
  regression catch. The remaining manual steps to take staging fully green
  are: (1) **DNS + zone binding** — create the
  `staging.atheon-api.vantax.co.za` (API) and chosen frontend host
  (e.g. `staging.atheon.vantax.co.za`) records on the `vantax.co.za`
  Cloudflare zone; (2) **Real D1/KV IDs** — the `[env.staging].d1_databases`
  and `[env.staging.kv_namespaces]` IDs are still the all-zero placeholders.
  Run `wrangler d1 create atheon-db-staging` and
  `wrangler kv:namespace create CACHE --env staging`, then paste the
  returned IDs into `workers/api/wrangler.toml`; (3) **Frontend target** —
  deploy a Pages or Worker for the chosen staging frontend host; (4) **Seed
  staging tenant** — `POST /api/v1/admin/migrate` then
  `POST /api/v1/admin/seed-vantax` against the staging API; (5) **GitHub
  environment secrets** — in the `staging` environment, add
  `E2E_STAGING_BASE_URL`, `E2E_STAGING_LOGIN_EMAIL`,
  `E2E_STAGING_LOGIN_PASSWORD`, and optionally `E2E_STAGING_LOGIN_TOTP_SEED`.
  Once those land, `workflow_dispatch` on `staging-e2e.yml` runs the
  Playwright suite end-to-end.

## Failure triage

| Symptom | Likely cause | Action |
| --- | --- | --- |
| `Missing required env var VERIFY_ADMIN_*` | creds not exported | export the seeded admin creds |
| `Login forbidden (403) … mandatory MFA` | v40: admin-tier account past MFA grace | set `VERIFY_DEMO_SECRET` (staging) or `VERIFY_ADMIN_TOTP_SEED` (prod) — see Credentials. Never weaken MFA |
| `Login returned no token … mandatory MFA but no authenticator` | MFA enforced, account not enrolled | enrol MFA + set `VERIFY_ADMIN_TOTP_SEED`, or use `VERIFY_DEMO_SECRET` |
| `MFA validation failed (4xx) … check VERIFY_ADMIN_TOTP_SEED` | wrong/stale seed or clock skew | confirm the seed matches the enrolled authenticator; runner clock must be ~UTC |
| Login 200 but suite empty | wrong `VERIFY_TENANT_SLUG` | confirm `vantax` |
| DR: "Couldn't find a D1 DB ... in your wrangler.jsonc" | config shadowing | ensure `--config wrangler.toml` (drill already does) |
| DR: error 7429 on a critical table | transient D1 CPU reset | drill retries 3× with backoff; re-run if persistent |
| Load gate FAIL on p99 | bcrypt login cost / cold workers | raise `LOAD_P99_THRESHOLD_MS` or warm the API |
| Accuracy timeout | reseed + 4 executions exceed budget | first run is ~13 min; do not set a shorter CI timeout |
