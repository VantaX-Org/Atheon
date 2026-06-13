# Board Digest PDF Export — Design Spec

**Date:** 2026-06-13
**Roadmap item:** Quick win #7 (`docs/superpowers/specs/2026-06-10-world-first-plan.md`)
**Status:** Approved design — ready for implementation plan.

## Problem

Gap #5 from the world-first plan: *"Board digest not exportable as PDF. Sales can't leave a 2-page leave-behind with prospect name."*

`BoardDigestPage.tsx` renders the board's quarterly outcomes (shared-savings, health, risk, forecast, compliance) on-screen but has **no export**. The only hint to users is a stale line of text telling them to go to `/apex` and ask an admin. Sales has no branded 2-page artefact to leave with a prospect.

## Goal

Add a **2-page Board Digest PDF** — deterministic (no LLM), Atheon-branded, audit-logged, R2-stored, carrying the active tenant's name on the cover — downloadable by **executive and up** from `BoardDigestPage`. Plus a secondary **"Full board pack"** link (admin+) that triggers the existing heavyweight LLM report.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| PDF scope | 2-page digest from the 5 on-screen tiles, **plus** a link to the existing full report | Digest = fast sales/board leave-behind; full pack = existing deep narrative. |
| Generation | **Server-side** new endpoint | Audit-logged + R2-stored like every billing artefact; deterministic; reuses branding. Client-side rejected (no audit trail / provenance). |
| Cover name | **Active tenant name** | Zero extra input; always traceable; dovetails with reskin-as-prospect demo flow (#8). |
| Digest RBAC | **executive and up** (`superadmin, support_admin, admin, executive`) | Export is an exec/sales action preparing a leave-behind. `board_member` *views* the digest on-screen; they do **not** download. Button is hidden for `board_member` (no 403-on-click). |
| Full pack RBAC | **admin+** (unchanged) | Existing `/api/board-report/*` gate. |
| No LLM in digest path | Deterministic render from tile metrics | Trade-secret-safe (nothing to leak); reproducible; cheap. |

## Architecture

### Files

- **Create** `workers/api/src/services/board-report-pdf-chrome.ts` — shared PDF chrome extracted from `board-report-engine.ts`: palette (navy/teal/gold/chalk/slate/red/amber/green), `pageHeader`, `pageFooter`, `formatZAR`, `sectionTitle`, `bodyText`. Both the full report and the digest import it (DRY; branding stays identical).
- **Modify** `workers/api/src/services/board-report-engine.ts` — import chrome from the new module instead of defining it inline. No behavioural change to the full report.
- **Create** `workers/api/src/services/board-digest-pdf.ts`:
  - `collectDigestData(DB, tenantId): Promise<DigestData>` — reads the **same sources** the 5 tiles use (see Data sources).
  - `generateBoardDigestPDF(data: DigestData, reportDate: string): Promise<ArrayBuffer>` — 2-page A4 portrait PDF using the shared chrome.
- **Create** `workers/api/src/routes/board-digest.ts` — Hono route module, two endpoints (below).
- **Modify** `workers/api/src/index.ts` — register `board-digest` prefix in `protectedPrefixes`, add `tenantIsolation`, add the executive+ `requireRole` gate, mount the module at `/api/board-digest` + `/api/v1/board-digest`.
- **Modify** `src/pages/BoardDigestPage.tsx` — add the Download PDF button (executive+), the Full board pack link (admin+), remove the stale text hint at line 281.
- **Modify** `src/lib/api.ts` — add `boardDigest.generate()` client method (and reuse existing download pattern).

### Data sources (`DigestData`)

`collectDigestData` MUST return exactly what the on-screen tiles show, so the PDF and the page never disagree:

| Field | Source (same as tile) |
|---|---|
| `company` (tenant name) | tenant record for `tenantId` |
| `recovered` (`total_realised_savings`), `billed` (`total_atheon_revenue`), `currency` | billing summary — `SUM(realised_savings_zar)`, `SUM(atheon_revenue_zar)` FROM `billable_periods` |
| `roiMultiple` | `recovered / billed` (0 when `billed === 0`) |
| `overallScore` | health score service (`apex.health`) — overall score only; the page renders no QoQ delta, so the digest carries none either |
| `withinBandRate` | forecast accuracy service |
| `risksCount` | risks service |
| `anomaliesCount` | pulse anomalies service |

**Compliance is NOT a live metric.** The page's compliance tile (`BoardDigestPage.tsx:263-274`) is **static SOC 2 posture copy** — "Atheon enforces SOC 2 CC6.1 (MFA), CC6.2 (access reviews), and CC7.3 (incident response)", with detail access noted as auditor+admin only. It fetches no number. The digest mirrors this as a fixed posture statement; it carries **no `mfaCoverage`/`cc61Status` fields**. Inventing a live coverage % would make the PDF disagree with the page.

Reuse the existing service functions the API endpoints call — do **not** re-query with ad-hoc SQL where a service already encapsulates the logic. Where the page calls an HTTP endpoint, call the underlying service/handler directly server-side.

## Endpoints

### `POST /api/board-digest/generate` (executive+)

1. Resolve `tenantId` (auth tenant; cross-tenant roles may override via `tenant_id` query — mirror `getTenantId` in `board-report.ts`).
2. `data = collectDigestData(DB, tenantId)`.
3. `pdf = generateBoardDigestPDF(data, reportDate)`.
4. `reportId = crypto.randomUUID()`; R2 `STORAGE.put('reports/${tenantId}/digest-${reportId}.pdf', pdf)`.
5. `INSERT INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_by, generated_at)` with `report_type='board_digest'`, `content` = JSON of `DigestData`.
6. `INSERT INTO audit_log (...)` `action='board_report.digest'`, `layer='governance'`, `resource='board_reports'`, `outcome='success'` (and `'failure'` row on error, mirroring `board-report.ts`).
7. Return `201 { id, pdfUrl: '/api/board-digest/${reportId}/pdf' }`.

On collect/render error: audit `outcome='failure'`, return `500 { error }`.

### `GET /api/board-digest/:id/pdf` (executive+)

1. Fetch `board_reports` row by `id`; **require `report_type='board_digest'` AND `tenant_id` matches** (cross-tenant roles may override). 404 otherwise — prevents pulling an admin-only full board pack through the executive-gated digest route.
2. Stream `r2_key` from `STORAGE`; `Content-Disposition: attachment; filename="${safeName}.pdf"` using the same sanitiser as `board-report.ts` (`.replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100)`).

## RBAC wiring

`/api/board-report/*` is gated by an explicit allow-list (`superadmin, support_admin, admin`) — a wildcard that cannot be selectively relaxed for one sub-path. So the digest gets its **own top-level prefix**:

```ts
for (const p of ['/api/board-digest/*', '/api/v1/board-digest/*']) {
  app.use(p, requireRole('superadmin', 'support_admin', 'admin', 'executive'));
}
```

Add `'board-digest'` to `protectedPrefixes`, add `tenantIsolation` for the prefix, and add `['board-digest', boardDigest]` to `routeModules`.

## PDF content (2 pages, A4 portrait)

**Page 1 — Cover + headline**
- Atheon wordmark (chrome `pageHeader`).
- Title "Board Digest"; **active tenant name** large beneath; report date + period ("Cumulative since first sync").
- Shared-savings hero: Recovered (`formatZAR`) as the dominant figure; Billed + ROI multiple as a supporting ledger.
- Atheon health score (overall score only — matches the page, which renders no QoQ delta).

**Page 2 — Governance**
- Critical risks count + active anomalies count.
- Forecast accuracy (within-band rate).
- Compliance posture: static SOC 2 statement mirroring the page — "Atheon enforces SOC 2 CC6.1 (MFA), CC6.2 (access reviews), CC7.3 (incident response). Detailed evidence available to the internal audit team via the Auditor role." No live metric.
- Per-metric source line (table / endpoint) under each figure — billing-artefact traceability.
- Footer (chrome `pageFooter`): "Prepared by Atheon Intelligence Platform | GONXT Technology (Pty) Ltd".

No model/provider is ever named (trade-secret rule). The digest path makes no LLM call.

## Frontend (`BoardDigestPage.tsx`)

- Read the current user's role from the app store — canonical pattern (`IAMPage.tsx:69-70`, `SupportConsolePage.tsx:228`): `const currentRole = useAppStore((s) => s.user)?.role || 'viewer'`.
- **Download PDF** button — rendered only when role ∈ {superadmin, support_admin, admin, executive}. Hidden for `board_member`. On click: `POST /api/board-digest/generate`; on success open/download `pdfUrl`. Button shows disabled + spinner while in flight; error toast on failure, then re-enable.
- **Full board pack** link — rendered only when role ∈ {superadmin, support_admin, admin}. Triggers existing `POST /api/board-report/generate` then downloads its `pdfUrl`.
- Remove stale text hint at `BoardDigestPage.tsx:281`.
- Button press: scale(0.97) active feedback, ≤160ms; download is keyboard/occasional — standard, not animated heavily.

## Error handling

- Backend collect/render failure → audit `failure` row + `500`. No partial R2 write left dangling (put only after successful render).
- Frontend generate failure → toast with retry; button re-enabled.
- `GET /:id/pdf` missing R2 object → 404.

## Testing (TDD)

**Unit — services**
- `collectDigestData` returns the full `DigestData` shape from a mocked DB; `roiMultiple` is 0 when `billed === 0`.
- `generateBoardDigestPDF` returns a non-empty `ArrayBuffer` starting with `%PDF`, containing 2 pages; tenant name appears in the byte stream.

**Endpoint**
- `POST /generate`: 200 for `executive`; 403 for `board_member` and `manager`; an `audit_log` row with `action='board_report.digest'` is written; `board_reports.report_type='board_digest'`; `STORAGE.put` called with `reports/${tenantId}/digest-*`.
- `GET /:id/pdf`: 200 for a `board_digest` row; **404 for a `board_report` (full pack) id** through the digest route.

**Frontend**
- Download PDF button hidden for `board_member`, visible for `executive`.
- Full board pack link hidden for `executive`, visible for `admin`.
- Click → generate called → download triggered; button shows loading state; error path shows toast and re-enables.

## Out of scope (YAGNI)

- Editable / free-text prospect name (decided: active tenant name only).
- `board_member` self-download.
- Scheduled / emailed digests.
- The 365-day "board pack autopilot" world-first bet (`board-pack-autopilot.ts`) — separate future track.

## Pre-implementation

Per the graphify-first rule, build the graph (`/graphify`) before writing code — `graphify-out/graph.json` does not yet exist. Use god nodes (`board-report-engine.ts`, `index.ts` route table) as the integration points for the new digest module.
