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

  const recovered = Number(billing?.recovered ?? 0);
  const billed = Number(billing?.billed ?? 0);

  return {
    company: tenant?.name || 'Your Organisation',
    recovered,
    billed,
    roiMultiple: billed > 0 ? recovered / billed : 0,
    currency: billing?.currency || 'ZAR',
    overallScore: Math.round(Number(health?.overall_score ?? 0)),
    withinBandRate: forecast?.within_band_rate == null ? null : Number(forecast.within_band_rate),
    risksCount: Number(risksRow?.n ?? 0),
    anomaliesCount: Number(anomaliesRow?.n ?? 0),
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
  const healthColor: readonly [number, number, number] =
    data.overallScore >= 70 ? green : data.overallScore >= 50 ? amber : red;
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
