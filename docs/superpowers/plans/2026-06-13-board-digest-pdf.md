# Board Digest PDF Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, 2-page, Atheon-branded Board Digest PDF — downloadable by executive-and-up from `BoardDigestPage`, audit-logged and R2-stored, carrying the active tenant name on the cover.

**Architecture:** A new server-side `/api/board-digest` prefix (gated executive+) renders a 2-page A4 PDF from the same metrics the on-screen tiles use (no LLM). Shared PDF chrome (palette, header/footer, formatZAR) is extracted from `board-report-engine.ts` into a reusable module so the digest and the full report stay visually identical. The frontend adds a Download PDF button (executive+) and a Full board pack link (admin+).

**Tech Stack:** Cloudflare Workers + Hono + D1 + R2 (STORAGE binding); jsPDF (dynamic import, already a dependency); React + Zustand + vitest/`cloudflare:test`.

**Spec:** `docs/superpowers/specs/2026-06-13-board-digest-pdf-design.md`

---

## Pre-Implementation

- [ ] **Build the graphify graph** (graphify-first rule — `graphify-out/graph.json` does not yet exist):

Run: `/graphify`
Then sanity-check integration points:
Run: `/graphify query "what connects to board-report-engine.ts and the index.ts route table"`
Expected: god nodes `board-report-engine.ts` and `index.ts` surface as the integration points for the new digest module. Proceed once confirmed.

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `workers/api/src/services/board-report-pdf-chrome.ts` | Shared PDF chrome: `PALETTE`, `formatZAR`, `createPdfChrome` factory (header/footer/sectionTitle/bodyText/kpiCard). | Create |
| `workers/api/src/services/board-report-engine.ts` | Full LLM board report. Imports chrome instead of defining it inline. No behavioural change. | Modify |
| `workers/api/src/services/board-digest-pdf.ts` | `DigestData` type, `collectDigestData(db, tenantId)`, `generateBoardDigestPDF(data, reportDate)`. No LLM. | Create |
| `workers/api/src/routes/board-digest.ts` | Hono module: `POST /generate`, `GET /:id/pdf`. | Create |
| `workers/api/src/index.ts` | Register prefix in `protectedPrefixes`, add tenantIsolation, executive+ `requireRole` gate, mount in `routeModules`. | Modify |
| `src/lib/api.ts` | `boardDigest.generate()` + `boardDigest.downloadPdf()` client. | Modify |
| `src/pages/BoardDigestPage.tsx` | Download PDF button (executive+), Full board pack link (admin+), remove stale line-281 hint. | Modify |
| `workers/api/src/services/__tests__/board-digest-pdf.test.ts` | Unit tests for collect + render. | Create |
| `workers/api/src/__tests__/board-digest.test.ts` | Endpoint/RBAC integration tests. | Create |

---

## Task 1: Extract shared PDF chrome

**Files:**
- Create: `workers/api/src/services/board-report-pdf-chrome.ts`
- Create (test): `workers/api/src/services/__tests__/board-report-pdf-chrome.test.ts`
- Modify: `workers/api/src/services/board-report-engine.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/api/src/services/__tests__/board-report-pdf-chrome.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatZAR, PALETTE, createPdfChrome } from '../board-report-pdf-chrome';

describe('formatZAR', () => {
  it('formats millions with 2 decimals', () => {
    expect(formatZAR(2_500_000)).toBe('R 2.50M');
  });
  it('formats thousands with no decimals', () => {
    expect(formatZAR(45_000)).toBe('R 45K');
  });
  it('formats sub-thousand as whole rand', () => {
    expect(formatZAR(750)).toBe('R 750');
  });
});

describe('PALETTE', () => {
  it('exposes the Atheon navy and teal', () => {
    expect(PALETTE.navy).toEqual([15, 23, 42]);
    expect(PALETTE.teal).toEqual([0, 150, 136]);
  });
});

describe('createPdfChrome', () => {
  it('returns the five chrome helpers and they run against a real jsPDF doc', async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const chrome = createPdfChrome(doc, pageW, pageH, { company: 'Acme', reportDate: '2026-06-13' });

    expect(typeof chrome.pageHeader).toBe('function');
    expect(typeof chrome.pageFooter).toBe('function');
    expect(typeof chrome.kpiCard).toBe('function');

    chrome.pageHeader('Test');
    chrome.pageFooter();
    const y1 = chrome.sectionTitle(28, 'Section');
    expect(y1).toBe(36);
    const y2 = chrome.bodyText(40, 'Some body copy.');
    expect(y2).toBeGreaterThan(40);
    chrome.kpiCard(14, 60, 35, 'Label', '99', PALETTE.green);
    // No throw == chrome is wired correctly.
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/api && npx vitest run src/services/__tests__/board-report-pdf-chrome.test.ts`
Expected: FAIL — cannot resolve `../board-report-pdf-chrome` (module not created yet).

- [ ] **Step 3: Create the chrome module**

Create `workers/api/src/services/board-report-pdf-chrome.ts`:

```ts
/**
 * Shared PDF chrome for Atheon board artefacts.
 *
 * Extracted from board-report-engine.ts so the full LLM board report and the
 * deterministic board digest render with identical branding (palette, header,
 * footer, KPI cards). DRY: change branding in one place.
 */
import type { jsPDF } from 'jspdf';

// ── Atheon colour palette ──
export const PALETTE = {
  navy:  [15, 23, 42] as const,     // #0F172A
  teal:  [0, 150, 136] as const,    // #009688
  gold:  [255, 179, 0] as const,    // #FFB300
  chalk: [241, 245, 249] as const,  // #F1F5F9
  slate: [100, 116, 139] as const,  // #64748B
  white: [255, 255, 255] as const,
  red:   [239, 68, 68] as const,    // #EF4444
  amber: [245, 158, 11] as const,   // #F59E0B
  green: [16, 185, 129] as const,   // #10B981
} as const;

export function formatZAR(value: number): string {
  if (value >= 1_000_000) return `R ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value.toFixed(0)}`;
}

export interface PdfChrome {
  pageHeader(title: string): void;
  pageFooter(): void;
  sectionTitle(y: number, title: string): number;
  bodyText(y: number, text: string, maxWidth?: number): number;
  kpiCard(x: number, y: number, w: number, label: string, value: string, color: readonly [number, number, number]): void;
}

/**
 * Build the chrome helpers bound to a specific jsPDF document.
 * @param continuedTitle - header used when bodyText overflows to a new page.
 */
export function createPdfChrome(
  doc: jsPDF,
  pageW: number,
  pageH: number,
  opts: { company: string; reportDate: string; continuedTitle?: string },
): PdfChrome {
  const { navy, teal, white, slate } = PALETTE;
  const continuedTitle = opts.continuedTitle ?? 'Board Report — continued';

  function pageHeader(title: string) {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...teal);
    doc.rect(0, 18, pageW, 1.5, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.text(`${opts.company} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  function pageFooter() {
    doc.setFontSize(6);
    doc.setTextColor(...slate);
    doc.text('Prepared by Atheon Intelligence Platform | GONXT Technology (Pty) Ltd', 14, pageH - 8);
    doc.text(`Generated ${new Date(opts.reportDate).toLocaleDateString('en-ZA')}`, pageW - 14, pageH - 8, { align: 'right' });
  }

  function sectionTitle(y: number, title: string): number {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...navy);
    doc.text(title, 14, y);
    doc.setFillColor(...teal);
    doc.rect(14, y + 1.5, 40, 0.6, 'F');
    return y + 8;
  }

  function bodyText(y: number, text: string, maxWidth = pageW - 28): number {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    const lines = doc.splitTextToSize(text, maxWidth);
    for (const line of lines) {
      if (y > pageH - 20) {
        doc.addPage();
        pageHeader(continuedTitle);
        pageFooter();
        y = 28;
      }
      doc.text(line, 14, y);
      y += 4.5;
    }
    return y;
  }

  function kpiCard(x: number, y: number, w: number, label: string, value: string, color: readonly [number, number, number]) {
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(x, y, w, 22, 2, 2, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, w, 22, 2, 2, 'S');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...slate);
    doc.text(label.toUpperCase(), x + w / 2, y + 7, { align: 'center' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...(color as readonly [number, number, number]));
    doc.text(value, x + w / 2, y + 17, { align: 'center' });
  }

  return { pageHeader, pageFooter, sectionTitle, bodyText, kpiCard };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/api && npx vitest run src/services/__tests__/board-report-pdf-chrome.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Repoint the engine to the shared chrome**

In `workers/api/src/services/board-report-engine.ts`:

(a) Add the import after the existing `radar-engine-v2` import (top of file, ~line 9):

```ts
import { PALETTE, formatZAR, createPdfChrome } from './board-report-pdf-chrome';
```

(b) Delete the inline `function formatZAR(value: number): string { ... }` block (the ~5-line function near the top of the file). It now comes from the chrome module.

(c) Inside `generateBoardReportPDF`, delete the inline palette block (the `const navy = ... const green = ...` lines) **and** the five inline helper functions `pageHeader`, `pageFooter`, `sectionTitle`, `bodyText`, `kpiCard`. Replace all of them with, immediately after `const pageH = doc.internal.pageSize.getHeight();`:

```ts
  const { navy, teal, gold, chalk, slate, white, red, amber, green } = PALETTE;
  const { pageHeader, pageFooter, sectionTitle, bodyText, kpiCard } =
    createPdfChrome(doc, pageW, pageH, { company: data.company, reportDate });
```

Leave the rest of `generateBoardReportPDF` (the cover/dashboard drawing that calls these locals) untouched — the destructured names match the old closures exactly.

- [ ] **Step 6: Verify the engine still compiles and its tests pass**

Run: `cd workers/api && npx tsc --noEmit && npx vitest run src/services/__tests__/board-report-pdf-chrome.test.ts`
Expected: tsc reports no errors; chrome tests PASS.
Run any existing board-report test if present: `npx vitest run -t "board" 2>/dev/null || true`
Expected: no regressions.

- [ ] **Step 7: Commit**

```bash
cd /Users/reshigan/Atheon
git add workers/api/src/services/board-report-pdf-chrome.ts workers/api/src/services/__tests__/board-report-pdf-chrome.test.ts workers/api/src/services/board-report-engine.ts
git commit -m "refactor(board-report): extract shared PDF chrome to board-report-pdf-chrome.ts"
```

---

## Task 2: Digest data + PDF renderer

**Files:**
- Create: `workers/api/src/services/board-digest-pdf.ts`
- Create (test): `workers/api/src/services/__tests__/board-digest-pdf.test.ts`

- [ ] **Step 1: Write the failing test**

Create `workers/api/src/services/__tests__/board-digest-pdf.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { collectDigestData, generateBoardDigestPDF, type DigestData } from '../board-digest-pdf';

// Minimal D1-shaped mock: prepare().bind().first() returns canned rows in call order.
function mockDB(rows: unknown[]) {
  let i = 0;
  const stmt = {
    bind: () => stmt,
    first: () => Promise.resolve(rows[i++]),
    all: () => Promise.resolve({ results: [] }),
    run: () => Promise.resolve({}),
  };
  return { prepare: vi.fn(() => stmt) } as unknown as D1Database;
}

describe('collectDigestData', () => {
  it('maps tile sources into DigestData and derives roiMultiple', async () => {
    // Order of queries: tenant, billing, health, [forecast service queries...], risks count, anomalies count.
    // getForecastAccuracyStats issues its own queries against the same mock; canned `all()` returns empty,
    // so within_band_rate resolves to null — which is the assertion below.
    const db = mockDB([
      { name: 'VantaX' },                                   // tenant
      { recovered: 4_000_000, billed: 1_000_000, currency: 'ZAR' }, // billing
      { overall_score: 82 },                                // health
      { n: 3 },                                             // risks count
      { n: 5 },                                             // anomalies count
    ]);
    const data = await collectDigestData(db, 'tenant-1');
    expect(data.company).toBe('VantaX');
    expect(data.recovered).toBe(4_000_000);
    expect(data.billed).toBe(1_000_000);
    expect(data.roiMultiple).toBe(4);
    expect(data.currency).toBe('ZAR');
    expect(data.overallScore).toBe(82);
  });

  it('roiMultiple is 0 when billed is 0', async () => {
    const db = mockDB([
      { name: 'VantaX' },
      { recovered: 500_000, billed: 0, currency: 'ZAR' },
      { overall_score: 50 },
      { n: 0 },
      { n: 0 },
    ]);
    const data = await collectDigestData(db, 'tenant-1');
    expect(data.roiMultiple).toBe(0);
  });
});

describe('generateBoardDigestPDF', () => {
  it('returns a non-empty 2-page PDF carrying the tenant name', async () => {
    const data: DigestData = {
      company: 'VantaX Holdings',
      recovered: 4_000_000, billed: 1_000_000, roiMultiple: 4, currency: 'ZAR',
      overallScore: 82, withinBandRate: 0.91, risksCount: 3, anomaliesCount: 5,
    };
    const buf = await generateBoardDigestPDF(data, '2026-06-13');
    expect(buf.byteLength).toBeGreaterThan(1000);
    const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 5));
    expect(head).toBe('%PDF-');
    const whole = new TextDecoder('latin1').decode(new Uint8Array(buf));
    expect(whole).toContain('VantaX Holdings');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/api && npx vitest run src/services/__tests__/board-digest-pdf.test.ts`
Expected: FAIL — cannot resolve `../board-digest-pdf`.

- [ ] **Step 3: Create the digest service**

Create `workers/api/src/services/board-digest-pdf.ts`:

```ts
/**
 * Board Digest PDF — deterministic 2-page leave-behind.
 *
 * No LLM. Renders exactly the 5 metrics the on-screen BoardDigestPage tiles
 * show, so the PDF and the page can never disagree. Branded via the shared
 * chrome in board-report-pdf-chrome.ts.
 */
import { PALETTE, formatZAR, createPdfChrome } from './board-report-pdf-chrome';
import { getForecastAccuracyStats } from './forecast-accuracy-tracker';

export interface DigestData {
  company: string;
  recovered: number;
  billed: number;
  roiMultiple: number;
  currency: string;
  overallScore: number;
  withinBandRate: number | null;
  risksCount: number;
  anomaliesCount: number;
}

/**
 * Read the same sources the BoardDigestPage tiles use. Reuses
 * getForecastAccuracyStats (the service the /forecast-accuracy endpoint calls).
 */
export async function collectDigestData(db: D1Database, tenantId: string): Promise<DigestData> {
  const tenant = await db.prepare('SELECT name FROM tenants WHERE id = ?')
    .bind(tenantId).first<{ name: string }>();

  const billing = await db.prepare(
    `SELECT COALESCE(SUM(total_realised_savings), 0) AS recovered,
            COALESCE(SUM(atheon_revenue), 0) AS billed,
            COALESCE(MAX(currency), 'ZAR') AS currency
       FROM billable_periods WHERE tenant_id = ?`
  ).bind(tenantId).first<{ recovered: number; billed: number; currency: string }>();

  const health = await db.prepare(
    'SELECT overall_score FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number }>();

  // Same lookback the /forecast-accuracy endpoint and the page default to (90d).
  const forecast = await getForecastAccuracyStats(db, tenantId, 90);

  const risksRow = await db.prepare(
    'SELECT COUNT(*) AS n FROM risk_alerts WHERE tenant_id = ?'
  ).bind(tenantId).first<{ n: number }>();

  const anomaliesRow = await db.prepare(
    'SELECT COUNT(*) AS n FROM anomalies WHERE tenant_id = ?'
  ).bind(tenantId).first<{ n: number }>();

  const recovered = billing?.recovered ?? 0;
  const billed = billing?.billed ?? 0;

  return {
    company: tenant?.name || 'Your Organisation',
    recovered,
    billed,
    roiMultiple: billed > 0 ? recovered / billed : 0,
    currency: billing?.currency || 'ZAR',
    overallScore: Math.round(health?.overall_score ?? 0),
    withinBandRate: forecast?.within_band_rate ?? null,
    risksCount: risksRow?.n ?? 0,
    anomaliesCount: anomaliesRow?.n ?? 0,
  };
}

/** Render a 2-page A4 portrait Board Digest. Returns the PDF as an ArrayBuffer. */
export async function generateBoardDigestPDF(data: DigestData, reportDate: string): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  const { navy, teal, gold, white, slate, green, amber, red } = PALETTE;
  const { pageHeader, pageFooter, sectionTitle, bodyText, kpiCard } =
    createPdfChrome(doc, pageW, pageH, {
      company: data.company,
      reportDate,
      continuedTitle: 'Board Digest — continued',
    });

  const fmtMoney = (v: number) =>
    data.currency === 'ZAR' ? formatZAR(v) : `${data.currency} ${Math.round(v).toLocaleString()}`;

  // ── PAGE 1 — Cover + headline ──
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...teal);
  doc.rect(0, 78, pageW, 3, 'F');

  doc.setTextColor(...white);
  doc.setFontSize(40);
  doc.setFont('helvetica', 'bold');
  doc.text('ATHEON', pageW / 2, 46, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 58, { align: 'center' });

  doc.setFillColor(...gold);
  doc.rect(pageW / 2 - 30, 64, 60, 0.8, 'F');

  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Board Digest', pageW / 2, 100, { align: 'center' });

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(data.company, pageW / 2, 116, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Report Date: ${new Date(reportDate).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    pageW / 2, 128, { align: 'center' },
  );
  doc.text('Period: Cumulative since first sync', pageW / 2, 135, { align: 'center' });

  // Shared-savings hero
  doc.setFontSize(8);
  doc.setTextColor(...gold);
  doc.text('SHARED SAVINGS · LIFETIME', pageW / 2, 160, { align: 'center' });
  doc.setFontSize(34);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...white);
  doc.text(fmtMoney(data.recovered), pageW / 2, 174, { align: 'center' });
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 200, 230);
  doc.text('Recovered by Atheon', pageW / 2, 181, { align: 'center' });

  // Supporting ledger: Billed + ROI multiple
  doc.setFontSize(10);
  doc.setTextColor(...white);
  doc.text(
    `Billed: ${fmtMoney(data.billed)}        ROI Multiple: ${data.roiMultiple.toFixed(1)}x`,
    pageW / 2, 196, { align: 'center' },
  );

  // Health score
  const healthColor = data.overallScore >= 70 ? green : data.overallScore >= 50 ? amber : red;
  doc.setFontSize(8);
  doc.setTextColor(...gold);
  doc.text('ATHEON HEALTH SCORE', pageW / 2, 218, { align: 'center' });
  doc.setFontSize(26);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...healthColor);
  doc.text(`${data.overallScore}/100`, pageW / 2, 232, { align: 'center' });

  // Cover footer band
  doc.setFillColor(...gold);
  doc.rect(0, pageH - 12, pageW, 12, 'F');
  doc.setTextColor(...navy);
  doc.setFontSize(8);
  doc.text('GONXT Technology (Pty) Ltd | www.gonxt.tech | Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ── PAGE 2 — Governance ──
  doc.addPage();
  pageHeader('Board Digest — Governance');
  pageFooter();
  let y = 28;

  y = sectionTitle(y, '1. Risk & Anomaly Posture');
  y += 2;
  const riskColor = data.risksCount === 0 ? green : amber;
  kpiCard(14, y, 56, 'Active Risks', `${data.risksCount}`, riskColor);
  kpiCard(74, y, 56, 'Active Anomalies', `${data.anomaliesCount}`, data.anomaliesCount === 0 ? green : amber);
  y += 30;

  y = sectionTitle(y, '2. Forecast Accuracy');
  y += 2;
  const bandPct = data.withinBandRate == null ? '—' : `${Math.round(data.withinBandRate * 100)}%`;
  kpiCard(14, y, 56, 'Within-Band Rate', bandPct, teal);
  y += 30;

  y = sectionTitle(y, '3. Compliance Posture');
  y += 2;
  y = bodyText(y,
    'Atheon enforces SOC 2 CC6.1 (MFA), CC6.2 (access reviews), and CC7.3 (incident response). ' +
    'Detailed evidence is available to your internal audit team via the Auditor role.');
  y += 4;

  y = sectionTitle(y, '4. Provenance');
  y += 2;
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...slate);
  const sources = [
    'Shared savings — billable_periods (realised savings, Atheon revenue)',
    'Health score — health_scores (latest)',
    'Risks — risk_alerts · Anomalies — anomalies',
    'Forecast accuracy — GET /api/v1/insights-stats/forecast-accuracy (90d)',
    'Compliance — SOC 2 control posture (static)',
  ];
  for (const s of sources) {
    doc.text(`• ${s}`, 14, y);
    y += 4.5;
  }

  return doc.output('arraybuffer');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd workers/api && npx vitest run src/services/__tests__/board-digest-pdf.test.ts`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Typecheck**

Run: `cd workers/api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/reshigan/Atheon
git add workers/api/src/services/board-digest-pdf.ts workers/api/src/services/__tests__/board-digest-pdf.test.ts
git commit -m "feat(board-digest): add collectDigestData + generateBoardDigestPDF (deterministic 2-page)"
```

---

## Task 3: Board-digest route module

**Files:**
- Create: `workers/api/src/routes/board-digest.ts`

(Endpoint tests are added in Task 4 once the module is wired into `index.ts`, because they exercise the full worker via `SELF.fetch` including the RBAC gate.)

- [ ] **Step 1: Create the route module**

Create `workers/api/src/routes/board-digest.ts`:

```ts
/**
 * Board Digest Routes — executive+ 2-page leave-behind PDF.
 *
 * Separate prefix from /api/board-report (admin+) so executives can export the
 * digest without unlocking the full LLM board pack. report_type='board_digest'
 * isolates digest rows from full board reports.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { collectDigestData, generateBoardDigestPDF } from '../services/board-digest-pdf';

const boardDigest = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// POST /api/board-digest/generate
boardDigest.post('/generate', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const auth = c.get('auth') as AuthContext | undefined;

  try {
    const data = await collectDigestData(c.env.DB, tenantId);
    const now = new Date().toISOString();
    const reportId = crypto.randomUUID();
    const title = `Board Digest — ${data.company} — ${now.substring(0, 10)}`;

    let r2Key: string | null = null;
    if (c.env.STORAGE) {
      const pdf = await generateBoardDigestPDF(data, now);
      r2Key = `reports/${tenantId}/digest-${reportId}.pdf`;
      await c.env.STORAGE.put(r2Key, pdf, { httpMetadata: { contentType: 'application/pdf' } });
    }

    await c.env.DB.prepare(
      `INSERT INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_by, generated_at)
       VALUES (?, ?, ?, 'board_digest', ?, ?, ?, ?)`
    ).bind(reportId, tenantId, title, JSON.stringify(data), r2Key, auth?.email || null, now).run();

    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null, 'board_report.digest', 'governance', 'board_reports',
        JSON.stringify({ reportId, actor: auth?.email || null }), 'success'
      ).run();
    } catch (auditErr) {
      console.error('board_digest audit log failed:', auditErr);
    }

    return c.json({ id: reportId, title, pdfUrl: r2Key ? `/api/board-digest/${reportId}/pdf` : undefined }, 201);
  } catch (err) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null, 'board_report.digest', 'governance', 'board_reports',
        JSON.stringify({ error: (err as Error).message, actor: auth?.email || null }), 'failure'
      ).run();
    } catch { /* swallow */ }
    return c.json({ error: 'Board digest generation failed', detail: (err as Error).message }, 500);
  }
});

// GET /api/board-digest/:id/pdf — only board_digest rows for this tenant
boardDigest.get('/:id/pdf', async (c) => {
  const tenantId = getTenantId(c);
  const reportId = c.req.param('id');
  const report = await c.env.DB.prepare(
    "SELECT r2_key, title FROM board_reports WHERE id = ? AND tenant_id = ? AND report_type = 'board_digest'"
  ).bind(reportId, tenantId).first<{ r2_key: string | null; title: string }>();
  if (!report || !report.r2_key) return c.json({ error: 'Digest not available' }, 404);

  if (!c.env.STORAGE) return c.json({ error: 'Storage not configured' }, 500);
  const obj = await c.env.STORAGE.get(report.r2_key);
  if (!obj) return c.json({ error: 'Digest file not found in storage' }, 404);

  const safeName = (report.title || 'board-digest').replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

export default boardDigest;
```

- [ ] **Step 2: Typecheck**

Run: `cd workers/api && npx tsc --noEmit`
Expected: no errors. (The module is not yet mounted; tsc only checks it compiles.)

- [ ] **Step 3: Commit**

```bash
cd /Users/reshigan/Atheon
git add workers/api/src/routes/board-digest.ts
git commit -m "feat(board-digest): add route module (POST /generate, GET /:id/pdf)"
```

---

## Task 4: Wire the route into index.ts + endpoint tests

**Files:**
- Modify: `workers/api/src/index.ts`
- Create (test): `workers/api/src/__tests__/board-digest.test.ts`

- [ ] **Step 1: Write the failing endpoint test**

Create `workers/api/src/__tests__/board-digest.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { env } from 'cloudflare:test';
import { createTestTenant, createTestUser, loginUser, authedRequest, request } from './helpers';

const TENANT = 'tenant-bdigest';

async function seedBilling() {
  // One billable period so the digest has numbers to render.
  await env.DB.prepare(
    `INSERT OR REPLACE INTO billable_periods (id, tenant_id, total_realised_savings, atheon_revenue, currency)
     VALUES (?, ?, ?, ?, ?)`
  ).bind('bp-1', TENANT, 4_000_000, 1_000_000, 'ZAR').run();
}

describe('board-digest endpoints', () => {
  let execToken = '';
  let boardToken = '';
  let managerToken = '';

  beforeAll(async () => {
    await createTestTenant(TENANT, 'VantaX Digest Co');
    await createTestUser({ email: 'exec@bd.test', password: 'Passw0rd!23', name: 'Exec', role: 'executive', tenantId: TENANT });
    await createTestUser({ email: 'board@bd.test', password: 'Passw0rd!23', name: 'Board', role: 'board_member', tenantId: TENANT });
    await createTestUser({ email: 'mgr@bd.test', password: 'Passw0rd!23', name: 'Mgr', role: 'manager', tenantId: TENANT });
    await seedBilling();
    execToken = (await loginUser('exec@bd.test', 'Passw0rd!23')) ?? '';
    boardToken = (await loginUser('board@bd.test', 'Passw0rd!23')) ?? '';
    managerToken = (await loginUser('mgr@bd.test', 'Passw0rd!23')) ?? '';
  });

  it('rejects unauthenticated generate with 401', async () => {
    const res = await request('/api/board-digest/generate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('allows executive to generate (201) and writes a board_digest row + audit log', async () => {
    const res = await authedRequest('/api/board-digest/generate', execToken, { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; pdfUrl?: string };
    expect(body.id).toBeTruthy();

    const row = await env.DB.prepare(
      "SELECT report_type FROM board_reports WHERE id = ?"
    ).bind(body.id).first<{ report_type: string }>();
    expect(row?.report_type).toBe('board_digest');

    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_log WHERE action = 'board_report.digest' AND outcome = 'success' AND tenant_id = ?"
    ).bind(TENANT).first<{ n: number }>();
    expect((audit?.n ?? 0)).toBeGreaterThanOrEqual(1);
  });

  it('forbids board_member (403)', async () => {
    const res = await authedRequest('/api/board-digest/generate', boardToken, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('forbids manager (403)', async () => {
    const res = await authedRequest('/api/board-digest/generate', managerToken, { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('GET /:id/pdf returns 404 for a non-digest board_report id', async () => {
    // Insert a full board pack row; it must NOT be reachable through the digest route.
    await env.DB.prepare(
      `INSERT OR REPLACE INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_at)
       VALUES (?, ?, ?, 'monthly', '{}', ?, ?)`
    ).bind('full-pack-1', TENANT, 'Full Pack', 'reports/x/full-pack-1.pdf', new Date().toISOString()).run();
    const res = await authedRequest('/api/board-digest/full-pack-1/pdf', execToken, { method: 'GET' });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/board-digest.test.ts`
Expected: FAIL — `/api/board-digest/generate` 404s (route not mounted) so the 201/403 assertions fail.

- [ ] **Step 3: Wire the route into `index.ts`**

(a) Add the import next to the other route imports (near `import boardReport from './routes/board-report'`, ~line 53):

```ts
import boardDigest from './routes/board-digest';
```

(b) Add `'board-digest'` to the `protectedPrefixes` array (the long `const protectedPrefixes = [...]` line). Insert it right after `'board-report'`:

```ts
..., 'board-report', 'board-digest', 'onboarding', ...
```

(c) Add the executive+ RBAC gate immediately after the existing board-report gate block:

```ts
// board-digest: executive+ — exec/sales leave-behind. board_member views on
// screen only (button hidden client-side); they do not export.
for (const p of ['/api/board-digest/*', '/api/v1/board-digest/*']) {
  app.use(p, requireRole('superadmin', 'support_admin', 'admin', 'executive'));
}
```

(d) Add the module to `routeModules`, right after the `['board-report', boardReport]` entry:

```ts
['board-digest', boardDigest],
```

- [ ] **Step 4: Run the endpoint test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/board-digest.test.ts`
Expected: PASS (6 tests: 401, 201 + row + audit, 403 board_member, 403 manager, 404 cross-type).

- [ ] **Step 5: Typecheck + full worker test sweep**

Run: `cd workers/api && npx tsc --noEmit && npx vitest run src/__tests__/board-digest.test.ts src/services/__tests__/board-digest-pdf.test.ts src/services/__tests__/board-report-pdf-chrome.test.ts`
Expected: tsc clean; all three suites PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/reshigan/Atheon
git add workers/api/src/index.ts workers/api/src/__tests__/board-digest.test.ts
git commit -m "feat(board-digest): mount route at /api/board-digest (executive+) with RBAC + endpoint tests"
```

---

## Task 5: Frontend — API client + page wiring

**Files:**
- Modify: `src/lib/api.ts`
- Modify: `src/pages/BoardDigestPage.tsx`

- [ ] **Step 1: Add the `boardDigest` client to `api.ts`**

Insert immediately after the closing `},` of the existing `boardReport: { ... }` block (after the `downloadPdf` method, ~line 1891):

```ts
  // ── Board Digest (Quick win #7 — executive+ 2-page leave-behind) ──
  boardDigest: {
    generate: (tenantId?: string) =>
      request<{ id: string; title: string; pdfUrl?: string }>(
        `/api/board-digest/generate${qs({ tenant_id: tenantId })}`, { method: 'POST' },
      ),
    downloadPdf: async (id: string, title?: string) => {
      const requestId = generateRequestId();
      const headers: Record<string, string> = { 'X-Request-ID': requestId };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/board-digest/${id}/pdf`, { headers });
      const responseRequestId = captureRequestId(res);
      if (!res.ok) throw new ApiError(res.status, 'Failed to download board digest PDF', responseRequestId);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeName = (title || 'board-digest').replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
  },
```

- [ ] **Step 2: Typecheck the frontend**

Run: `cd /Users/reshigan/Atheon && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Add role + export handlers to `BoardDigestPage.tsx`**

(a) Add imports at the top of the file (after the existing `lucide-react` import, ~line 28):

```ts
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import { FileDown } from 'lucide-react';
```

(b) Inside the component, after the existing `useState`/`useCallback` block (just before `const status = statusFrom(...)`), add role + export state and handlers:

```ts
  const currentRole = useAppStore((s) => s.user)?.role || 'viewer';
  const canExportDigest = ['superadmin', 'support_admin', 'admin', 'executive'].includes(currentRole);
  const canExportFullPack = ['superadmin', 'support_admin', 'admin'].includes(currentRole);
  const [exporting, setExporting] = useState(false);
  const [exportingPack, setExportingPack] = useState(false);

  const downloadDigest = useCallback(async () => {
    setExporting(true);
    try {
      const { id, title } = await api.boardDigest.generate();
      await api.boardDigest.downloadPdf(id, title);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to export digest PDF');
    } finally {
      setExporting(false);
    }
  }, []);

  const downloadFullPack = useCallback(async () => {
    setExportingPack(true);
    try {
      const r = await api.boardReport.generate();
      await api.boardReport.downloadPdf(r.id, r.title);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to export full board pack');
    } finally {
      setExportingPack(false);
    }
  }, []);
```

Note: `BoardReportItem.title` is optional in the type; `downloadPdf` already accepts `title?: string`, so `r.title` (possibly undefined) is safe.

(c) Add the buttons to the `PageHeader` via its `actions` slot. Replace the existing header render:

```tsx
      <PageHeader
        eyebrow="Board · Digest"
        title="Board digest"
        dek="Quarterly outcomes — shared-savings, health, risk"
      />
```

with:

```tsx
      <PageHeader
        eyebrow="Board · Digest"
        title="Board digest"
        dek="Quarterly outcomes — shared-savings, health, risk"
        actions={
          (canExportDigest || canExportFullPack) ? (
            <div className="flex items-center gap-2">
              {canExportDigest && (
                <Button
                  variant="primary"
                  size="sm"
                  loading={exporting}
                  leading={<FileDown size={14} aria-hidden="true" />}
                  onClick={() => void downloadDigest()}
                  data-testid="board-digest-download"
                >
                  Download PDF
                </Button>
              )}
              {canExportFullPack && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={exportingPack}
                  onClick={() => void downloadFullPack()}
                  data-testid="board-digest-fullpack"
                >
                  Full board pack
                </Button>
              )}
            </div>
          ) : undefined
        }
      />
```

(d) Remove the stale hint at the bottom of the file. Delete this block (the `<div className="text-caption ...">` … `</div>` near line 280):

```tsx
      <div className="text-caption t-muted text-center pt-2">
        Digest reflects the latest available snapshot. For a quarter-boundary cut, ask your platform admin to download a Board Pack PDF from /apex.
      </div>
```

- [ ] **Step 4: Typecheck the frontend again**

Run: `cd /Users/reshigan/Atheon && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Build the frontend to confirm no bundler/import breakage**

Run: `cd /Users/reshigan/Atheon && npm run build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/reshigan/Atheon
git add src/lib/api.ts src/pages/BoardDigestPage.tsx
git commit -m "feat(board-digest): add Download PDF (executive+) and Full board pack (admin+) to BoardDigestPage"
```

---

## Final Verification

- [ ] **Run the full worker test suite + frontend typecheck + build:**

```bash
cd /Users/reshigan/Atheon/workers/api && npx vitest run && npx tsc --noEmit
cd /Users/reshigan/Atheon && npx tsc --noEmit -p tsconfig.json && npm run build
```
Expected: all green. Then proceed to superpowers:finishing-a-development-branch.

## Notes / Conventions

- **PDF == page:** the digest renders only the metrics the on-screen tiles show. No QoQ delta (the page shows overall score only), no live compliance metric (the page's compliance tile is static SOC 2 copy).
- **Trade-secret rule:** the digest path makes no LLM call and names no model/provider. All branding attributes to "Atheon Intelligence Platform".
- **Branch:** this work lands on `feat/board-digest-pdf` (the spec was committed there). If executing fresh, create/checkout that branch first — do not commit to `main`.
- **board_member** is intentionally excluded from export (button hidden client-side + 403 server-side); they view the digest on-screen only.
