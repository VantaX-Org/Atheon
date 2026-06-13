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
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });
});
