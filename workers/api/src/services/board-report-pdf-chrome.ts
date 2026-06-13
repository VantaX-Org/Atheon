/**
 * Shared PDF chrome for Atheon board artefacts.
 *
 * Extracted from board-report-engine.ts so the full board report and the
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
