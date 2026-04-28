# 10-Day Go-Live Sprint

Last updated: 2026-04-28 (post PR #290 — catalog-aware defaults + cross-cutting handlers)

This is the work that stands between "production-grade engineering" and "we can announce". It's deliberately tight: ten working days with named owners and a daily checkbox cadence. Items grouped by wave and severity.

Production is currently on `main` (`a18a95b`, PR #290). API + frontend healthy. Engineering is not the gate — this sprint is about operational hardening, secret hygiene, observability retention, customer-success readiness, and one moat-surfacing build.

## Pre-flight (already done in this session, recapped here)

- [x] Catalyst execution gap closed — 374 sub-catalysts now route via catalog-aware default + 6 cross-cutting handlers (PR #290)
- [x] Three world-first capabilities live: closed-loop calibration, cryptographic provenance ledger, DP-noised peer patterns (PRs #285, #286, #287, #288)
- [x] Coverage matrix test guards 300+ catalog entries against silent regressions
- [x] 761 backend + 48 frontend tests green; 10 E2E suites green
- [x] Hybrid + on-prem deploy paths live (license phone-home, fail-closed after 7d)

## Day 1 — Secret rotation drill (BLOCKER)

Everything else in this sprint is moot if the auth surface is leaking. Tier-1 from `GO_LIVE_CHECKLIST.md` §22-31.

- [ ] Rotate `JWT_SECRET` (Cloudflare Worker secret) — invalidates all existing sessions
- [ ] Rotate `ENCRYPTION_KEY` — re-encrypt ERP credentials (run the migration drill in `runbook.md` §15)
- [ ] Rotate `WEBHOOK_SECRET` and per-tenant webhook secrets that were live during the leak window
- [ ] Re-login drill rehearsed against staging, then prod
- [ ] Confirm `traceability.spec.ts` passes against production after rotation

**Owner:** ops + lead eng. **Stop-the-world if not done.**

## Day 2 — Email + MS Graph (BLOCKER)

- [ ] Set real `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` in production
- [ ] Verify `/forgot-password` round-trip end-to-end on prod (currently broken — placeholder secret)
- [ ] Verify SSO login works with the corrected tenant id

**Owner:** ops. **Without this, user self-service is broken.**

## Day 3 — Observability retention

- [ ] Wire Cloudflare Logpush → R2 (`atheon-logs` bucket, 30-day retention)
   - Requires Cloudflare API key with `logpush:edit` scope
   - Configuration script lives at `scripts/configure-logpush.sh` (added in this sprint)
- [ ] Confirm Sentry is receiving events on staging (`captureException` paths exercise: 500, slow query, queue failure)
- [ ] Hook prod alarms to Sentry breach (>1% 5xx over 5 min → page on-call)

**Owner:** ops. **Required for incident retro after launch.**

## Day 4 — Backups + DR drill

- [x] Automated nightly D1 export → R2 (GitHub Action, added in this sprint, `.github/workflows/backup-d1.yml`)
- [ ] Restore drill: pull last night's backup into staging D1, smoke-test critical paths (login, dashboard, catalyst run)
- [ ] Document the restore procedure in `runbook.md` §16
- [ ] R2 backup retention: 30 daily snapshots + 12 monthly snapshots (lifecycle rule)

**Owner:** ops + eng. **DR is unproven if not rehearsed.**

## Day 5 — Production E2E + load smoke

- [ ] Run full Playwright E2E suite against production (10 spec files): `npm run test:e2e -- --project=production`
- [ ] Synthetic load: 50 concurrent tenants, 200 catalyst runs/hour, 60 minutes; capture p50/p95/p99 + error rate
   - Use the demo seeder (`POST /api/v1/seed-vantax/seed-findings-demo`) on a throwaway staging tenant
- [ ] Identify any D1 query >1s and add an index or batch (PR #212 patterns)
- [ ] Document the rate-limit ceilings observed

**Owner:** eng. **Confirms scale ceiling for first 10 paying customers.**

## Day 6 — Trust & Performance page (MOAT)

- [x] Build `/trust` route — single buyer-facing dashboard aggregating the three world-firsts (added in this sprint, `src/pages/TrustPerformancePage.tsx`)
- [ ] Wire it into the public marketing site (post-merge, 1-line redirect)
- [ ] Capture a 60-second screen recording for the sales deck
- [ ] Optionally make it logged-out-accessible (via a per-tenant share token) so sales can demo it without a login

**Owner:** eng. **Without this, the moat is invisible to buyers.**

## Day 7 — Customer success motion

- [ ] First-week onboarding playbook (Notion / Confluence) — kick-off call template, ERP credentialing checklist, first-finding review, SLA expectations
- [ ] Support ticket SLA: <4h ack on critical, <24h ack on high, weekly review of unresolved
- [ ] In-app product tour (existing wizard or Intercom-style overlay) for first login
- [ ] "First finding to action" runbook: what does a customer DO with finding #1?

**Owner:** customer success. **Without this, paying customers will churn from confusion, not product gaps.**

## Day 8 — Documentation finalisation

- [ ] Public-facing API doc site (existing `routes/openapi.ts` already emits OpenAPI; render via Redoc / Swagger UI on `atheon-api.vantax.co.za/docs`)
- [ ] Customer admin guide (`TENANT_MANAGEMENT_GUIDE.md` exists — verify currency)
- [ ] Hybrid deployment quick-start (8-page README for the docker-compose path)
- [ ] Pricing page on the marketing site (Stripe products mapped to plan tiers)

**Owner:** eng + marketing.

## Day 9 — Internal dry-run

- [ ] Whole-company demo against a fresh tenant, end-to-end: signup → ERP connect → first assessment → first catalyst run → first HITL approval → provenance verify → peer-pattern view
- [ ] Capture every paper-cut: log them in a tracking sheet, severity-rate them, fix the P0/P1 before announcement
- [ ] Roll back what doesn't work; do not paper over

**Owner:** all hands. **Last chance to find UX bugs before paying customers do.**

## Day 10 — Launch day

- [ ] T-2h: freeze merges to `main`
- [ ] T-1h: final E2E suite against prod
- [ ] T-0: announcement goes live
- [ ] T+0 → T+30min: live `wrangler tail` watch, on-call ready, error rate < 1% over 5 min sustained
- [ ] T+24h: post-launch review — capture `tenant_llm_usage`, `webhook_deliveries`, `audit_log` snapshots; identify the first three things to fix

**Owner:** lead eng. **Have a rollback plan ready (`runbook.md` §3).**

## What I (Claude) shipped in this sprint

Engineering items deliverable as code, included in the PR that adds this document:

1. **GO_LIVE_SPRINT.md** — this document.
2. **`.github/workflows/backup-d1.yml`** — nightly D1 export → R2 with 30-day daily / 12-month monthly retention. Dispatchable manually for ad-hoc backups.
3. **`scripts/configure-logpush.sh`** — Cloudflare Logpush configuration script (idempotent; takes `CLOUDFLARE_API_TOKEN` from env). Comments document the prerequisites: R2 bucket name + API token scope.
4. **`src/pages/TrustPerformancePage.tsx`** — the moat-surfacing buyer dashboard. Aggregates calibration accuracy (90d), provenance Merkle root + verify, peer-pattern coverage. Routed at `/trust`.

Items deferred to ops/customer-success because they need credentials or human coordination — those are the boxes above. None of them are engineering-blocked.

## Severity grades (where we are now)

| Dimension | Pre-sprint | Post-sprint target |
|---|---|---|
| Engine + product depth | A | A |
| Multi-tenant + multi-company | A | A |
| Test coverage (synthetic) | A− | A− |
| Auth / RBAC | A− | A (post-rotation drill) |
| Frontend completeness | B+ | A− (post Trust page) |
| Operational readiness | B | A− (post Logpush + backups) |
| Security hygiene | B− | A− (post secret rotation) |
| Email / forgot-password | C | A (post MS_GRAPH fix) |
| Real-world load | Unknown | B+ (post day-5 load smoke) |
| Customer success motion | C+ | B+ (post day-7 playbooks) |

If every box ticks: **Day 10 is announce-able.** If any Tier-1 (Day 1–2) slips, the announcement slips with it — those are non-negotiable.
