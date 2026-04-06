/**
 * Board Report Engine
 * 
 * Generates comprehensive executive board reports with LLM,
 * creates an Atheon-themed PDF using jsPDF, stores in R2.
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';
import { computeStrategicContext } from './radar-engine-v2';

interface BoardReportData {
  company: string;
  industry: string;
  healthScore: number;
  dimensions: Record<string, { score: number; trend: string; delta: number }>;
  context: Record<string, unknown>;
  risks: Array<{ title: string; severity: string; category: string }>;
  diagnostics: { activeRCAs: number; pendingPrescriptions: number };
  roi: { identified: number; recovered: number; roiMultiple: number; personHours: number } | null;
  effectiveness: Array<{ subCatalyst: string; runs: number; recoveryRate: number; valueFound: number }>;
}

function formatZAR(value: number): string {
  if (value >= 1_000_000) return `R ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `R ${(value / 1_000).toFixed(0)}K`;
  return `R ${value.toFixed(0)}`;
}

/**
 * Generate an Atheon-themed PDF from the board report data + markdown content.
 */
async function generateBoardReportPDF(
  data: BoardReportData,
  markdown: string,
  reportDate: string,
): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Atheon colour palette ──
  const navy  = [15, 23, 42] as const;     // #0F172A
  const teal  = [0, 150, 136] as const;    // #009688
  const gold  = [255, 179, 0] as const;    // #FFB300
  const chalk = [241, 245, 249] as const;  // #F1F5F9
  const slate = [100, 116, 139] as const;  // #64748B
  const white = [255, 255, 255] as const;
  const red   = [239, 68, 68] as const;    // #EF4444
  const amber = [245, 158, 11] as const;   // #F59E0B
  const green = [16, 185, 129] as const;   // #10B981

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
    doc.text(`${data.company} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  function pageFooter() {
    doc.setFontSize(6);
    doc.setTextColor(...slate);
    doc.text('Prepared by Atheon Intelligence Platform | GONXT Technology (Pty) Ltd', 14, pageH - 8);
    doc.text(`Generated ${new Date(reportDate).toLocaleDateString('en-ZA')}`, pageW - 14, pageH - 8, { align: 'right' });
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
        pageHeader('Board Report — continued');
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
    doc.setTextColor(...color);
    doc.text(value, x + w / 2, y + 17, { align: 'center' });
  }

  // ═══════════════════════════════════════════════
  // PAGE 1 — Cover
  // ═══════════════════════════════════════════════
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...teal);
  doc.rect(0, 85, pageW, 3, 'F');

  doc.setTextColor(...white);
  doc.setFontSize(42);
  doc.setFont('helvetica', 'bold');
  doc.text('ATHEON', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 62, { align: 'center' });

  doc.setFillColor(...gold);
  doc.rect(pageW / 2 - 30, 68, 60, 0.8, 'F');

  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Board Report', pageW / 2, 105, { align: 'center' });
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Strategic Intelligence & Performance Summary', pageW / 2, 115, { align: 'center' });

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(data.company, pageW / 2, 140, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.setFont('helvetica', 'normal');
  doc.text(`Industry: ${data.industry.charAt(0).toUpperCase() + data.industry.slice(1)}`, pageW / 2, 155, { align: 'center' });
  doc.text(`Report Date: ${new Date(reportDate).toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' })}`, pageW / 2, 163, { align: 'center' });
  doc.text('CONFIDENTIAL — For Board Members Only', pageW / 2, 180, { align: 'center' });

  doc.setFillColor(...gold);
  doc.rect(0, pageH - 12, pageW, 12, 'F');
  doc.setTextColor(...navy);
  doc.setFontSize(8);
  doc.text('GONXT Technology (Pty) Ltd | www.gonxt.tech | Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ═══════════════════════════════════════════════
  // PAGE 2 — Executive Dashboard
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Executive Dashboard');
  pageFooter();
  let y = 28;

  y = sectionTitle(y, '1. Business Health Score');
  y += 2;
  const healthColor = data.healthScore >= 70 ? green : data.healthScore >= 50 ? amber : red;
  kpiCard(14, y, 35, 'Overall Health', `${data.healthScore}/100`, healthColor);

  const dims = Object.entries(data.dimensions);
  const cardW = dims.length > 0 ? Math.min(35, (pageW - 28 - 35 - 4) / Math.min(dims.length, 4) - 2) : 30;
  let cardX = 53;
  for (const [dimName, dimData] of dims.slice(0, 4)) {
    const dimColor = (dimData?.score ?? 0) >= 70 ? green : (dimData?.score ?? 0) >= 50 ? amber : red;
    kpiCard(cardX, y, cardW, dimName.charAt(0).toUpperCase() + dimName.slice(1), `${dimData?.score ?? 0}`, dimColor);
    cardX += cardW + 2;
  }
  y += 30;

  // Risk Register
  y = sectionTitle(y, '2. Risk Register');
  y += 2;
  if (data.risks.length === 0) {
    y = bodyText(y, 'No active risks at this time.');
  } else {
    doc.setFillColor(...navy);
    doc.rect(14, y, pageW - 28, 7, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Risk Title', 16, y + 5);
    doc.text('Severity', pageW - 65, y + 5);
    doc.text('Category', pageW - 35, y + 5);
    y += 7;
    for (let ri = 0; ri < Math.min(data.risks.length, 8); ri++) {
      const risk = data.risks[ri];
      if (y > pageH - 25) { doc.addPage(); pageHeader('Executive Dashboard — continued'); pageFooter(); y = 28; }
      if (ri % 2 === 0) { doc.setFillColor(chalk[0], chalk[1], chalk[2]); } else { doc.setFillColor(white[0], white[1], white[2]); }
      doc.rect(14, y, pageW - 28, 7, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text((risk.title || '').substring(0, 60), 16, y + 5);
      const sevColor: [number, number, number] = risk.severity === 'critical' ? [red[0], red[1], red[2]] : risk.severity === 'high' ? [amber[0], amber[1], amber[2]] : [green[0], green[1], green[2]];
      doc.setTextColor(sevColor[0], sevColor[1], sevColor[2]);
      doc.setFont('helvetica', 'bold');
      doc.text((risk.severity || '').toUpperCase(), pageW - 65, y + 5);
      doc.setTextColor(30, 41, 59);
      doc.setFont('helvetica', 'normal');
      doc.text(risk.category || '', pageW - 35, y + 5);
      y += 7;
    }
    y += 4;
  }

  // Diagnostics
  if (y > pageH - 40) { doc.addPage(); pageHeader('Executive Dashboard — continued'); pageFooter(); y = 28; }
  y = sectionTitle(y, '3. Diagnostics Summary');
  y += 2;
  kpiCard(14, y, 40, 'Active RCAs', `${data.diagnostics.activeRCAs}`, data.diagnostics.activeRCAs > 0 ? amber : green);
  kpiCard(58, y, 40, 'Pending Prescriptions', `${data.diagnostics.pendingPrescriptions}`, data.diagnostics.pendingPrescriptions > 0 ? amber : green);
  y += 30;

  // ROI
  if (y > pageH - 50) { doc.addPage(); pageHeader('Financial Impact & ROI'); pageFooter(); y = 28; }
  y = sectionTitle(y, '4. Financial Impact & ROI');
  y += 2;
  if (data.roi) {
    kpiCard(14, y, 40, 'Value Identified', formatZAR(data.roi.identified as number), teal);
    kpiCard(58, y, 40, 'Value Recovered', formatZAR(data.roi.recovered as number), green);
    kpiCard(102, y, 35, 'ROI Multiple', `${data.roi.roiMultiple}x`, gold);
    kpiCard(141, y, 40, 'Hours Saved', `${data.roi.personHours}`, teal);
    y += 30;
  } else {
    y = bodyText(y, 'No ROI data available for this reporting period.');
  }

  // Catalyst Effectiveness
  if (data.effectiveness.length > 0) {
    if (y > pageH - 50) { doc.addPage(); pageHeader('Operational Performance'); pageFooter(); y = 28; }
    y = sectionTitle(y, '5. Catalyst Performance');
    y += 2;
    doc.setFillColor(...navy);
    doc.rect(14, y, pageW - 28, 7, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Sub-Catalyst', 16, y + 5);
    doc.text('Runs', pageW - 80, y + 5, { align: 'right' });
    doc.text('Success Rate', pageW - 55, y + 5, { align: 'right' });
    doc.text('Value Found', pageW - 16, y + 5, { align: 'right' });
    y += 7;
    for (let ei = 0; ei < data.effectiveness.length; ei++) {
      const eff = data.effectiveness[ei];
      if (y > pageH - 25) { doc.addPage(); pageHeader('Operational Performance — continued'); pageFooter(); y = 28; }
      if (ei % 2 === 0) { doc.setFillColor(chalk[0], chalk[1], chalk[2]); } else { doc.setFillColor(white[0], white[1], white[2]); }
      doc.rect(14, y, pageW - 28, 7, 'F');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(String(eff.subCatalyst || ''), 16, y + 5);
      doc.text(String(eff.runs ?? ''), pageW - 80, y + 5, { align: 'right' });
      doc.text(typeof eff.recoveryRate === 'number' ? `${Math.round(eff.recoveryRate)}%` : '', pageW - 55, y + 5, { align: 'right' });
      doc.text(typeof eff.valueFound === 'number' ? formatZAR(eff.valueFound) : '', pageW - 16, y + 5, { align: 'right' });
      y += 7;
    }
    y += 4;
  }

  // ═══════════════════════════════════════════════
  // PAGE(S) — Full Report Content (from LLM markdown)
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Detailed Intelligence Report');
  pageFooter();
  y = 28;

  const markdownLines = markdown.split('\n');
  for (const line of markdownLines) {
    const trimmed = line.trim();
    if (!trimmed) { y += 3; continue; }
    if (y > pageH - 20) { doc.addPage(); pageHeader('Detailed Intelligence Report — continued'); pageFooter(); y = 28; }

    if (trimmed.startsWith('# ')) {
      y += 4;
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...navy);
      doc.text(trimmed.replace(/^#\s+/, ''), 14, y);
      doc.setFillColor(...teal);
      doc.rect(14, y + 2, 50, 0.6, 'F');
      y += 10;
    } else if (trimmed.startsWith('## ')) {
      y += 3;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...navy);
      doc.text(trimmed.replace(/^##\s+/, ''), 14, y);
      y += 7;
    } else if (trimmed.startsWith('### ')) {
      y += 2;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...teal);
      doc.text(trimmed.replace(/^###\s+/, ''), 14, y);
      y += 6;
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const cleanText = trimmed.replace(/^[-*]\s+/, '').replace(/\*\*/g, '');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(30, 41, 59);
      doc.text('\u2022', 16, y);
      const wrappedLines = doc.splitTextToSize(cleanText, pageW - 35);
      for (const wl of wrappedLines) {
        if (y > pageH - 20) { doc.addPage(); pageHeader('Detailed Intelligence Report — continued'); pageFooter(); y = 28; }
        doc.text(wl, 20, y);
        y += 4.5;
      }
    } else if (/^\d+\.\s+/.test(trimmed)) {
      const numMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        const cleanText = numMatch[2].replace(/\*\*/g, '');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(30, 41, 59);
        doc.text(`${numMatch[1]}.`, 16, y);
        const wrappedLines = doc.splitTextToSize(cleanText, pageW - 35);
        for (const wl of wrappedLines) {
          if (y > pageH - 20) { doc.addPage(); pageHeader('Detailed Intelligence Report — continued'); pageFooter(); y = 28; }
          doc.text(wl, 22, y);
          y += 4.5;
        }
      }
    } else {
      y = bodyText(y, trimmed.replace(/\*\*/g, '').replace(/\*/g, ''));
    }
  }

  // ═══════════════════════════════════════════════
  // LAST PAGE — Disclaimer
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Disclaimer');
  pageFooter();
  y = 35;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(14, y, pageW - 28, 50, 3, 3, 'F');
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...slate);
  const disclaimerLines = doc.splitTextToSize(
    'This report was generated by the Atheon Intelligence Platform using AI-assisted analysis of operational, financial, and strategic data. ' +
    'While every effort is made to ensure accuracy, the insights and recommendations contained herein are based on available data and should be validated ' +
    'by qualified professionals before being used for decision-making. All financial figures are presented in South African Rand (ZAR). ' +
    'This document is confidential and intended for authorised board members only. Distribution without prior written consent is prohibited.',
    pageW - 38
  );
  for (const dl of disclaimerLines) {
    doc.text(dl, 19, y);
    y += 4.5;
  }

  y += 15;
  doc.setFillColor(...navy);
  doc.roundedRect(14, y, pageW - 28, 30, 3, 3, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('ATHEON', pageW / 2, y + 12, { align: 'center' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Intelligence that drives decisions.', pageW / 2, y + 20, { align: 'center' });
  doc.setFillColor(...teal);
  doc.rect(pageW / 2 - 20, y + 24, 40, 0.5, 'F');

  return doc.output('arraybuffer');
}

export async function generateBoardReport(
  db: D1Database,
  tenantId: string,
  env: { AI: Ai; STORAGE?: R2Bucket },
  generatedBy?: string,
): Promise<{ id: string; title: string; generatedAt: string; reportMonth: string; status: 'completed' | 'failed'; contentMarkdown: string; pdfUrl?: string; sections: string[] }> {
  // 1) Fetch health score + dimensions
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  // 2) Fetch strategic context from Radar
  let context: Record<string, unknown> = {};
  try {
    context = await computeStrategicContext(db, tenantId, env);
  } catch { /* empty context */ }

  // 3) Fetch top risks
  const risks = await db.prepare(
    "SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 10"
  ).bind(tenantId).all();

  // 4) Fetch diagnostics summary
  const diagActive = await db.prepare(
    "SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).first<{ cnt: number }>();
  const diagPrescriptions = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending'"
  ).bind(tenantId).first<{ cnt: number }>();

  // 5) Fetch ROI summary
  const roi = await db.prepare(
    'SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  // 6) Fetch catalyst effectiveness top-line
  const effectiveness = await db.prepare(
    'SELECT cluster_id, sub_catalyst_name, runs_count, success_rate, total_value_processed FROM catalyst_effectiveness WHERE tenant_id = ? ORDER BY total_value_processed DESC LIMIT 5'
  ).bind(tenantId).all();

  // 7) Build LLM prompt
  const llmConfig = await loadLlmConfig(db, tenantId);
  const tenant = await db.prepare('SELECT name, industry FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string; industry: string }>();

  const dataPayload: BoardReportData = {
    company: tenant?.name || 'Company',
    industry: tenant?.industry || 'general',
    healthScore: health?.overall_score || 0,
    dimensions: health?.dimensions ? JSON.parse(health.dimensions) : {},
    context,
    risks: risks.results.map((r: Record<string, unknown>) => ({ title: r.title as string, severity: r.severity as string, category: r.category as string })),
    diagnostics: { activeRCAs: diagActive?.cnt || 0, pendingPrescriptions: diagPrescriptions?.cnt || 0 },
    roi: roi ? { identified: roi.total_discrepancy_value_identified as number, recovered: roi.total_discrepancy_value_recovered as number, roiMultiple: roi.roi_multiple as number, personHours: roi.total_person_hours_saved as number } : null,
    effectiveness: effectiveness.results.map((e: Record<string, unknown>) => ({ subCatalyst: e.sub_catalyst_name as string, runs: e.runs_count as number, recoveryRate: e.success_rate as number, valueFound: e.total_value_processed as number })),
  };

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are Atheon Intelligence. Generate an executive board report with sections:
1. Strategic Overview
2. Business Health
3. Risk Register
4. Root Cause Analysis Summary
5. Operational Performance
6. Financial Impact & ROI
7. Recommended Actions

Write in professional third-person tone. Format with markdown headers. Use ZAR for currency. Reference South African context where relevant.`,
    },
    {
      role: 'user',
      content: `Generate a board report using these data points:\n${JSON.stringify(dataPayload, null, 2)}`,
    },
  ];

  let reportMarkdown = '';
  try {
    const result = await llmChatWithFallback(llmConfig, env.AI, messages, { maxTokens: 3000 });
    reportMarkdown = result.text;
  } catch {
    reportMarkdown = `# Board Report — ${tenant?.name || 'Company'}\n\n## Strategic Overview\nHealth score: ${health?.overall_score || 0}/100\n\n## Risk Register\n${risks.results.length} active risks.\n\n## ROI\n${roi ? `ROI multiple: ${roi.roi_multiple}x` : 'No ROI data available.'}\n`;
  }

  // 8) Store in board_reports
  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = `Board Report — ${now.substring(0, 10)}`;

  const contentJson = {
    markdown: reportMarkdown,
    data: dataPayload,
    generatedAt: now,
  };

  // 9) Generate Atheon-themed PDF and store in R2
  let r2Key: string | null = null;
  if (env.STORAGE) {
    try {
      const pdfBuffer = await generateBoardReportPDF(dataPayload, reportMarkdown, now);
      r2Key = `reports/${tenantId}/${reportId}.pdf`;
      await env.STORAGE.put(r2Key, pdfBuffer, {
        httpMetadata: { contentType: 'application/pdf' },
      });
    } catch (err) {
      console.error('Failed to generate board report PDF:', err);
      r2Key = null;
    }
  }

  // 10) Store metadata
  await db.prepare(
    `INSERT INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_by, generated_at)
     VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?)`
  ).bind(reportId, tenantId, title, JSON.stringify(contentJson), r2Key, generatedBy || null, now).run();

  // Extract section headers from markdown for sections array
  const sectionHeaders = reportMarkdown.match(/^#{1,2}\s+.+$/gm)?.map(h => h.replace(/^#+\s+/, '')) || [];

  return {
    id: reportId,
    title,
    generatedAt: now,
    reportMonth: now.substring(0, 7),
    status: 'completed' as const,
    contentMarkdown: reportMarkdown,
    pdfUrl: r2Key ? `/api/board-report/${reportId}/pdf` : undefined,
    sections: sectionHeaders,
  };
}
