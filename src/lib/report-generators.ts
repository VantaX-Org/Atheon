/**
 * Client-side PDF and Excel report generators for Assessment reports.
 * These run in the browser using jsPDF and SheetJS (xlsx), avoiding
 * Cloudflare Workers runtime compatibility issues with these libraries.
 */
import type { Assessment, AssessmentResults } from './api';

// ── Helpers ────────────────────────────────────────────────────────────────

function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(Math.round(amount));
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

// ── Business Case PDF ──────────────────────────────────────────────────────

export async function generateBusinessPDF(assessment: Assessment): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const results = assessment.results as AssessmentResults | null;
  const scores = results?.catalyst_scores ?? [];
  const sizing = results?.technical_sizing;
  const config = assessment.config as Record<string, unknown>;
  const snapshot = (results?.volume_snapshot ?? assessment.dataSnapshot ?? {}) as Record<string, unknown>;

  if (scores.length === 0) {
    alert('No catalyst scores available to generate report.');
    return;
  }

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const prospectName = assessment.prospectName || 'Prospect';

  // Colour palette
  const navy  = [27, 58, 107] as const;
  const teal  = [0, 150, 136] as const;
  const gold  = [255, 179, 0] as const;
  const slate = [55, 71, 79] as const;
  const lightBg = [245, 248, 255] as const;
  const white = [255, 255, 255] as const;

  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const deploymentModel = str(config.deployment_model, 'saas');
  const annualLicence = sizing
    ? (deploymentModel === 'saas'
      ? sizing.annual_licence_revenue
      : deploymentModel === 'hybrid' ? num(config.hybrid_licence_fee_pa) : num(config.onprem_licence_fee_pa))
    : 0;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  function pageHeader(title: string) {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...teal);
    doc.rect(0, 18, pageW, 1.5, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(13);
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.text(`${prospectName} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  function pageFooter() {
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text('Prepared by GONXT Technology | Atheon Intelligence Platform', 14, pageH - 8);
    doc.text(`Generated ${new Date().toLocaleDateString('en-ZA')}`, pageW - 14, pageH - 8, { align: 'right' });
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
  doc.text('ATHEON', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(11);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 62, { align: 'center' });
  doc.setFillColor(...gold);
  doc.rect(pageW / 2 - 30, 68, 60, 0.8, 'F');
  doc.setFontSize(20);
  doc.text('AI Catalyst Assessment', pageW / 2, 105, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Business Case & Value Proposition', pageW / 2, 115, { align: 'center' });
  doc.setFontSize(16);
  doc.text(prospectName, pageW / 2, 140, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 160, { align: 'center' });
  doc.text(`ERP System: ${str(snapshot.erp_system, 'N/A')}`, pageW / 2, 168, { align: 'center' });
  doc.text(`Data Period: ${num(snapshot.months_of_data)} months of transaction data`, pageW / 2, 176, { align: 'center' });
  doc.text('CONFIDENTIAL — For Authorised Recipients Only', pageW / 2, 190, { align: 'center' });
  doc.setFillColor(...gold);
  doc.rect(0, pageH - 12, pageW, 12, 'F');
  doc.setTextColor(...navy);
  doc.setFontSize(8);
  doc.text('GONXT Technology (Pty) Ltd | www.gonxt.tech | Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ═══════════════════════════════════════════════
  // PAGE 2 — Executive Summary
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Executive Summary');

  const kpis = [
    { label: 'Total Est. Annual Savings', value: `R ${formatZAR(totalSaving)}`, color: teal },
    { label: 'AI Catalysts Identified', value: `${scores.length}`, color: navy },
    { label: 'Payback Period', value: `${paybackMonths} months`, color: gold },
    { label: 'Return on Investment', value: `${roi}%`, color: teal },
    { label: 'Recommended First Catalyst', value: scores[0]?.catalyst_name || 'N/A', color: navy },
    { label: 'Data Completeness', value: `${num(snapshot.data_completeness_pct)}%`, color: gold },
  ];

  const kpiW = (pageW - 30) / 3;
  kpis.forEach((kpi, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 10 + col * (kpiW + 5);
    const ky = 28 + row * 30;
    doc.setFillColor(...lightBg);
    doc.roundedRect(x, ky, kpiW, 25, 2, 2, 'F');
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(x, ky, 2, 25, 'F');
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(kpi.label, x + 6, ky + 8);
    doc.setFontSize(14);
    doc.setTextColor(...slate);
    const valText = doc.splitTextToSize(kpi.value, kpiW - 10);
    doc.text(valText[0], x + 6, ky + 19);
  });

  let y = 95;
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text('Assessment Overview', 14, y);
  y += 2;
  doc.setFillColor(...teal);
  doc.rect(14, y, 30, 0.5, 'F');
  y += 7;

  const narrative = str(results?.narrative, `This assessment identified ${scores.length} AI catalysts with a combined estimated annual saving of R ${formatZAR(totalSaving)}. The recommended first deployment is ${scores[0]?.catalyst_name || 'N/A'} with the highest return potential.`);
  doc.setFontSize(9);
  doc.setTextColor(...slate);
  const narrativeLines = doc.splitTextToSize(narrative, pageW - 28);
  doc.text(narrativeLines, 14, y);
  y += narrativeLines.length * 4.5 + 8;

  doc.setFillColor(245, 245, 245);
  doc.roundedRect(14, y, pageW - 28, 18, 2, 2, 'F');
  doc.setFillColor(...navy);
  doc.rect(14, y, 2, 18, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...navy);
  doc.text('DATA SOURCE', 20, y + 6);
  doc.setTextColor(...slate);
  doc.text(`${str(snapshot.erp_system, 'ERP')} | ${num(snapshot.months_of_data)} months | ${num(snapshot.monthly_invoices)} invoices/month | ${num(snapshot.employee_count)} employees | ${num(snapshot.active_customer_count)} customers`, 20, y + 13);
  pageFooter();

  // ═══════════════════════════════════════════════
  // PAGE 3 — Savings by Catalyst
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Savings by Catalyst');

  y = 28;
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Estimated Annual Savings by AI Catalyst', 14, y);
  y += 8;

  const maxSaving = Math.max(...scores.map(s => s.estimated_annual_saving_zar), 1);
  const barMaxW = pageW - 90;
  const barColors = [[0,150,136],[27,58,107],[255,179,0],[76,175,80],[156,39,176],[233,30,99],[63,81,181]] as const;

  scores.forEach((cat, idx) => {
    const barW = (cat.estimated_annual_saving_zar / maxSaving) * barMaxW;
    const color = barColors[idx % barColors.length];
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    const labelLines = doc.splitTextToSize(cat.catalyst_name, 55);
    doc.text(labelLines[0], 14, y + 4);
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(72, y, Math.max(barW, 2), 7, 1, 1, 'F');
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, 72 + Math.max(barW, 2) + 3, y + 5);
    y += 12;
  });

  // Summary table
  y += 8;
  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  const tCols = ['#', 'Catalyst', 'Domain', 'Sub-Catalysts', 'Est. Annual Saving', 'Confidence'];
  const tX = [16, 24, 68, 100, 145, 182];
  tCols.forEach((col, i) => doc.text(col, tX[i], y + 5.5));

  y += 10;
  doc.setTextColor(...slate);
  scores.forEach((cat, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(...lightBg);
      doc.rect(14, y - 3.5, pageW - 28, 7, 'F');
    }
    doc.setFontSize(7);
    doc.text(`${cat.priority}`, tX[0], y);
    doc.text(cat.catalyst_name.substring(0, 25), tX[1], y);
    doc.text(cat.domain, tX[2], y);
    doc.text(`${cat.sub_catalysts.length}`, tX[3], y);
    doc.setTextColor(...navy);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, tX[4], y);
    const confColor = cat.confidence === 'high' ? teal : cat.confidence === 'medium' ? gold : [200,200,200] as const;
    doc.setFillColor(confColor[0], confColor[1], confColor[2]);
    doc.roundedRect(tX[5], y - 3, 14, 5, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(6);
    doc.text(cat.confidence.toUpperCase(), tX[5] + 2, y);
    doc.setTextColor(...slate);
    doc.setFontSize(7);
    y += 7;
  });

  y += 2;
  doc.setFillColor(...teal);
  doc.rect(14, y - 3.5, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(9);
  doc.text('TOTAL ESTIMATED ANNUAL SAVINGS', 16, y + 1);
  doc.text(`R ${formatZAR(totalSaving)}`, tX[4], y + 1);
  pageFooter();

  // ═══════════════════════════════════════════════
  // PAGES 4–N — Catalyst Deep Dives (top 5)
  // ═══════════════════════════════════════════════
  const topCatalysts = scores.slice(0, 5);
  for (const cat of topCatalysts) {
    doc.addPage();
    pageHeader(`Catalyst Deep Dive: ${cat.catalyst_name}`);

    let py = 26;
    doc.setFillColor(...lightBg);
    doc.roundedRect(14, py, pageW - 28, 16, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(`Domain: ${cat.domain}`, 18, py + 6);
    doc.text(`Priority: ${cat.priority}`, 80, py + 6);
    doc.text(`Confidence: ${cat.confidence.toUpperCase()}`, 120, py + 6);
    doc.setTextColor(...navy);
    doc.text(`Est. Annual Saving: R ${formatZAR(cat.estimated_annual_saving_zar)}`, 18, py + 13);
    py += 22;

    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Key Data Insights', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    doc.setTextColor(...slate);
    for (const insight of cat.data_insights) {
      doc.setFillColor(...teal);
      doc.circle(17, py - 1, 1, 'F');
      const lines = doc.splitTextToSize(insight, pageW - 36);
      doc.text(lines, 22, py);
      py += lines.length * 4 + 3;
    }

    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Savings Breakdown', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    const catMaxSave = Math.max(...cat.saving_components.map(c => c.amount_zar), 1);
    for (const comp of cat.saving_components) {
      doc.setFontSize(8);
      doc.setTextColor(...slate);
      doc.text(comp.label, 18, py);
      doc.text(`R ${formatZAR(comp.amount_zar)}`, 130, py);
      const miniBarW = (comp.amount_zar / catMaxSave) * 50;
      doc.setFillColor(...teal);
      doc.roundedRect(150, py - 3, Math.max(miniBarW, 1), 4, 0.5, 0.5, 'F');
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text(comp.methodology, 18, py + 4);
      doc.setTextColor(...slate);
      py += 10;
    }

    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Sub-Catalyst Deployment Sequence', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    cat.sub_catalysts.forEach((sc, i) => {
      doc.setFillColor(...navy);
      doc.circle(19, py - 1, 3, 'F');
      doc.setTextColor(...white);
      doc.setFontSize(6);
      doc.text(`${i + 1}`, 17.5, py);
      doc.setTextColor(...slate);
      doc.setFontSize(8);
      doc.text(`${sc.name}`, 26, py);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`${sc.estimated_monthly_volume} ${sc.volume_unit}/month | R ${formatZAR(sc.estimated_annual_saving_zar)}/year`, 26, py + 4);
      if (sc.deploy_prerequisite) {
        doc.text(`Prerequisite: ${sc.deploy_prerequisite}`, 26, py + 8);
        py += 4;
      }
      py += 10;
    });

    pageFooter();
  }

  // ═══════════════════════════════════════════════
  // LAST PAGE — Deployment Roadmap
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Deployment Roadmap');

  y = 28;
  const phases = [
    { label: 'Phase 1 — Quick Wins (Month 1–2)', desc: 'Deploy highest-impact catalysts with fastest payback', catalysts: scores.filter(c => c.deploy_order <= 2), color: teal },
    { label: 'Phase 2 — Core Expansion (Month 3–4)', desc: 'Extend AI coverage to operational processes', catalysts: scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4), color: navy },
    { label: 'Phase 3 — Full Intelligence (Month 5–6)', desc: 'Complete platform deployment with advanced analytics', catalysts: scores.filter(c => c.deploy_order >= 5), color: gold },
  ];

  for (const phase of phases) {
    if (phase.catalysts.length === 0) continue;
    doc.setFillColor(phase.color[0], phase.color[1], phase.color[2]);
    doc.roundedRect(14, y, pageW - 28, 8, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(9);
    doc.text(phase.label, 18, y + 5.5);
    y += 11;
    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(phase.desc, 18, y);
    y += 5;
    doc.setFontSize(8);
    for (const cat of phase.catalysts) {
      doc.setTextColor(...slate);
      doc.text(`\u2022 ${cat.catalyst_name}`, 22, y);
      doc.setTextColor(...navy);
      doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}/year`, 140, y);
      y += 5;
    }
    y += 6;
  }

  // Investment Summary Box
  y += 4;
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, y, pageW - 28, 38, 3, 3, 'F');
  doc.setFillColor(...navy);
  doc.rect(14, y, 3, 38, 'F');
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text('Investment Summary', 22, y + 9);
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text(`Platform Licence (${deploymentModel.toUpperCase()}):`, 22, y + 17);
  doc.text(`R ${formatZAR(annualLicence)}/year`, 120, y + 17);
  doc.text('Estimated Annual Savings:', 22, y + 23);
  doc.setTextColor(...teal);
  doc.text(`R ${formatZAR(totalSaving)}/year`, 120, y + 23);
  doc.setTextColor(...slate);
  doc.text('Net Annual Benefit:', 22, y + 29);
  doc.text(`R ${formatZAR(totalSaving - annualLicence)}/year`, 120, y + 29);
  doc.text('Payback Period:', 22, y + 35);
  doc.setTextColor(...navy);
  doc.text(`${paybackMonths} months`, 120, y + 35);

  y += 50;
  doc.setFillColor(...teal);
  doc.roundedRect(pageW / 2 - 55, y, 110, 14, 3, 3, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(10);
  doc.text('Ready to activate? Contact GONXT Technology', pageW / 2, y + 9, { align: 'center' });
  pageFooter();

  // Trigger download
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${prospectName.replace(/[^a-zA-Z0-9]/g, '_')}-business-case.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Excel Model ────────────────────────────────────────────────────────────

export async function generateExcelReport(assessment: Assessment): Promise<void> {
  const XLSX = await import('xlsx');
  const results = assessment.results as AssessmentResults | null;
  const scores = results?.catalyst_scores ?? [];
  const sizing = results?.technical_sizing;
  const config = assessment.config as Record<string, unknown>;
  const snapshot = (results?.volume_snapshot ?? assessment.dataSnapshot ?? {}) as Record<string, unknown>;

  if (scores.length === 0) {
    alert('No catalyst scores available to generate report.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const deploymentModel = str(config.deployment_model, 'saas');
  const annualLicence = sizing
    ? (deploymentModel === 'saas'
      ? sizing.annual_licence_revenue
      : deploymentModel === 'hybrid' ? num(config.hybrid_licence_fee_pa) : num(config.onprem_licence_fee_pa))
    : 0;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  // Sheet 1 — Executive Summary
  const summaryData: (string | number)[][] = [
    ['ATHEON INTELLIGENCE PLATFORM — AI Catalyst Assessment Model'],
    [''],
    ['KEY METRICS', '', 'VALUE'],
    ['Total Estimated Annual Savings', '', totalSaving],
    ['AI Catalysts Identified', '', scores.length],
    ['Recommended First Catalyst', '', scores[0]?.catalyst_name || 'N/A'],
    ['Platform Licence (Annual)', '', annualLicence],
    ['Net Annual Benefit', '', totalSaving - annualLicence],
    ['Payback Period', '', `${paybackMonths} months`],
    ['Return on Investment', '', `${roi}%`],
    ['Deployment Model', '', deploymentModel.toUpperCase()],
    ['Contract Duration', '', `${num(config.contract_years, 3)} years`],
    ['Target Users', '', num(config.target_users, 50)],
    [''],
    ['ERP DATA PROFILE'],
    ['ERP System', '', str(snapshot.erp_system, 'N/A')],
    ['Months of Data', '', num(snapshot.months_of_data)],
    ['Data Completeness', '', `${num(snapshot.data_completeness_pct)}%`],
    ['Monthly Invoices', '', num(snapshot.monthly_invoices)],
    ['Monthly POs', '', num(snapshot.monthly_purchase_orders)],
    ['Employees', '', num(snapshot.employee_count)],
    ['Active Customers', '', num(snapshot.active_customer_count)],
    ['Active Suppliers', '', num(snapshot.active_supplier_count)],
    ['Total Revenue (12m)', '', num(snapshot.total_revenue_12m)],
    ['Total Spend (12m)', '', num(snapshot.total_spend_12m)],
    [''],
    ['DEPLOYMENT ROADMAP'],
    ['Phase 1 (Month 1-2)', '', scores.filter(c => c.deploy_order <= 2).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 2 (Month 3-4)', '', scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 3 (Month 5-6)', '', scores.filter(c => c.deploy_order >= 5).map(c => c.catalyst_name).join(', ') || 'N/A'],
    [''],
    ['Generated by Atheon Intelligence Platform | GONXT Technology (Pty) Ltd'],
    [`Date: ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 35 }, { wch: 5 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary');

  // Sheet 2 — Catalyst Savings Model
  const savingsData: (string | number)[][] = [
    ['CATALYST SAVINGS MODEL'],
    [''],
    ['Priority', 'Catalyst', 'Domain', 'Sub-Catalyst', 'Volume/Month', 'Unit', 'Est. Annual Saving (ZAR)', 'Confidence', 'Deploy Order'],
  ];
  let grandTotal = 0;
  for (const cat of scores) {
    let catTotal = 0;
    for (const sc of cat.sub_catalysts) {
      savingsData.push([
        cat.priority, cat.catalyst_name, cat.domain, sc.name,
        sc.estimated_monthly_volume, sc.volume_unit,
        sc.estimated_annual_saving_zar, cat.confidence, cat.deploy_order,
      ]);
      catTotal += sc.estimated_annual_saving_zar;
    }
    savingsData.push(['', `${cat.catalyst_name} SUBTOTAL`, '', '', '', '', catTotal, '', '']);
    grandTotal += catTotal;
  }
  savingsData.push(['', '', '', '', '', '', '', '', '']);
  savingsData.push(['', 'GRAND TOTAL', '', '', '', '', grandTotal, '', '']);
  const savingsSheet = XLSX.utils.aoa_to_sheet(savingsData);
  savingsSheet['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 15 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, savingsSheet, 'Catalyst Savings');

  // Sheet 3 — Catalyst Deep Dives
  const deepDiveData: (string | number)[][] = [
    ['CATALYST DEEP DIVES'],
    [''],
  ];
  for (const cat of scores) {
    deepDiveData.push([`${cat.catalyst_name} (${cat.domain})`, '', '', '', '']);
    deepDiveData.push(['Priority', cat.priority, 'Confidence', cat.confidence, '']);
    deepDiveData.push(['Est. Annual Saving', cat.estimated_annual_saving_zar, 'Deploy Order', cat.deploy_order, '']);
    deepDiveData.push(['']);
    deepDiveData.push(['Data Insights:']);
    for (const insight of cat.data_insights) {
      deepDiveData.push([`  - ${insight}`]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Savings Components:', 'Label', 'Amount (ZAR)', 'Methodology']);
    for (const comp of cat.saving_components) {
      deepDiveData.push(['', comp.label, comp.amount_zar, comp.methodology]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Sub-Catalysts:', 'Name', 'Volume/Month', 'Unit', 'Annual Saving (ZAR)']);
    for (const sc of cat.sub_catalysts) {
      deepDiveData.push(['', sc.name, sc.estimated_monthly_volume, sc.volume_unit, sc.estimated_annual_saving_zar]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['']);
  }
  const deepDiveSheet = XLSX.utils.aoa_to_sheet(deepDiveData);
  deepDiveSheet['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, deepDiveSheet, 'Catalyst Deep Dives');

  // Sheet 4 — Volume Data
  const volData: (string | number)[][] = [
    ['ERP VOLUME DATA SNAPSHOT'],
    [''],
    ['Category', 'Metric', 'Value', 'Description'],
    ['Transaction', 'Monthly Invoices', num(snapshot.monthly_invoices), 'Average invoices processed per month'],
    ['Transaction', 'Monthly Purchase Orders', num(snapshot.monthly_purchase_orders), 'Average POs per month'],
    ['Transaction', 'Monthly Journal Entries', num(snapshot.monthly_journal_entries), 'Average journal entries per month'],
    ['Transaction', 'Monthly Bank Transactions', num(snapshot.monthly_bank_transactions), 'Average bank transactions per month'],
    ['Financial', 'Total AR Balance', num(snapshot.total_ar_balance), 'Accounts receivable outstanding'],
    ['Financial', 'Total AP Balance', num(snapshot.total_ap_balance), 'Accounts payable outstanding'],
    ['Financial', 'Revenue (12m)', num(snapshot.total_revenue_12m), 'Total revenue last 12 months (ZAR)'],
    ['Financial', 'Spend (12m)', num(snapshot.total_spend_12m), 'Total spend last 12 months (ZAR)'],
    ['Organisation', 'Employees', num(snapshot.employee_count), 'Active employee count'],
    ['Organisation', 'Active Customers', num(snapshot.active_customer_count), 'Unique active customers'],
    ['Organisation', 'Active Suppliers', num(snapshot.active_supplier_count), 'Unique active suppliers'],
    ['Inventory', 'Products', num(snapshot.product_count), 'Active product SKUs'],
    ['Inventory', 'Inventory Value', num(snapshot.total_inventory_value), 'Total inventory on hand (ZAR)'],
    ['Data', 'Months of Data', num(snapshot.months_of_data), 'Historical data depth'],
    ['Data', 'Data Completeness', num(snapshot.data_completeness_pct), 'Data quality score (%)'],
    ['Data', 'ERP System', str(snapshot.erp_system, 'N/A'), 'Source ERP platform'],
  ];
  const volSheet = XLSX.utils.aoa_to_sheet(volData);
  volSheet['!cols'] = [{ wch: 15 }, { wch: 28 }, { wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, volSheet, 'Volume Data');

  // Sheet 5 — Infrastructure (if sizing available)
  if (sizing) {
    const infraData: (string | number)[][] = [
      ['INFRASTRUCTURE COST MODEL'],
      [''],
      ['Service Component', 'Monthly Volume', 'SaaS Cost (ZAR/mo)'],
      ['Workers (API Calls)', `${sizing.total_monthly_api_calls.toLocaleString()} calls`, sizing.cost_cf_workers],
      ['D1 Database', `${sizing.total_db_size_gb} GB`, sizing.cost_cf_d1],
      ['Vectorize (Embeddings)', `${sizing.total_monthly_vector_queries.toLocaleString()} queries`, sizing.cost_cf_vectorize],
      ['Workers AI (LLM)', `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens`, sizing.cost_cf_workers_ai],
      ['R2 Object Storage', `${sizing.total_storage_gb} GB`, sizing.cost_cf_r2],
      ['KV Cache', `${sizing.total_kv_reads_monthly.toLocaleString()} reads`, sizing.cost_cf_kv],
      [''],
      ['TOTALS'],
      ['Total Infra Cost/month', '', sizing.total_infra_cost_pm_saas],
      ['Monthly Revenue', '', sizing.monthly_licence_revenue],
      ['Gross Margin/month', '', sizing.gross_margin_pm_saas],
      ['Gross Margin %', '', sizing.gross_margin_pct_saas],
      ['Annual Licence Revenue', '', sizing.annual_licence_revenue],
    ];
    const infraSheet = XLSX.utils.aoa_to_sheet(infraData);
    infraSheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, infraSheet, 'Infrastructure Costs');
  }

  // Sheet 6 — 3-Year Projection
  const projData: (string | number)[][] = [
    ['3-YEAR FINANCIAL PROJECTION'],
    [''],
    ['Metric', 'Year 1', 'Year 2', 'Year 3', 'Total'],
    ['Estimated Savings', totalSaving, Math.round(totalSaving * 1.1), Math.round(totalSaving * 1.2), Math.round(totalSaving * 3.3)],
    ['Platform Licence Cost', annualLicence, Math.round(annualLicence * 1.03), Math.round(annualLicence * 1.06), Math.round(annualLicence * 3.09)],
    ['Net Benefit', totalSaving - annualLicence, Math.round(totalSaving * 1.1 - annualLicence * 1.03), Math.round(totalSaving * 1.2 - annualLicence * 1.06), Math.round(totalSaving * 3.3 - annualLicence * 3.09)],
    ['Cumulative Benefit', totalSaving - annualLicence, Math.round(totalSaving * 2.1 - annualLicence * 2.03), Math.round(totalSaving * 3.3 - annualLicence * 3.09), ''],
  ];
  const projSheet = XLSX.utils.aoa_to_sheet(projData);
  projSheet['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, projSheet, 'Financial Projection');

  // Write and download
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${assessment.prospectName.replace(/[^a-zA-Z0-9]/g, '_')}-financial-model.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
