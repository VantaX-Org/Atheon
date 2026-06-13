import { describe, it, expect, vi } from 'vitest';
import { collectDigestData, generateBoardDigestPDF, type DigestData } from '../board-digest-pdf';

// Minimal D1-shaped mock: prepare().bind().first() returns canned rows in call order.
// getForecastAccuracyStats uses .all() (not .first()), so it gets {results:[]} and
// resolves to { total_graded: 0, within_band_rate: null, ... } harmlessly.
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
    const db = mockDB([
      { name: 'VantaX' },                                            // tenant
      { recovered: 4_000_000, billed: 1_000_000, currency: 'ZAR' },  // billing
      { overall_score: 82 },                                         // health
      { n: 3 },                                                      // risks count
      { n: 5 },                                                      // anomalies count
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
