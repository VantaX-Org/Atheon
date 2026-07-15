/**
 * Phase 10-2 — External signals feed (FX + commodity).
 *
 * Mocks fetch to verify each source builds the right URL, parses the
 * response correctly, persists to external_signals, and skips
 * gracefully when unavailable.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  frankfurterFxSource,
  eiaOilSource,
  worldBankMacroSource,
  gdeltNewsSource,
  sweepExternalSignals,
  type ExternalSignalSource,
} from '../services/external-signals-feed';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT_A = 'sig-tenant-a';
const TENANT_B = 'sig-tenant-b';

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 10-2 — external signals feed', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT_A);
    await seedTenant(TENANT_B);
    // Migration may seed default tenants (e.g. demo). Deactivate every
    // tenant except the two this suite owns so industry-aware sweeps
    // only fan out over A + B.
    await env.DB.prepare(
      `UPDATE tenants SET status = 'inactive' WHERE id NOT IN (?, ?)`
    ).bind(TENANT_A, TENANT_B).run();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id IN (?, ?)').bind(TENANT_A, TENANT_B).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  describe('frankfurterFxSource', () => {
    it('fetches USD/ZAR + EUR/ZAR + GBP/ZAR and shapes ExternalSignalReading', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({
          rates: { ZAR: 18.5 }, date: '2026-05-02',
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          rates: { ZAR: 20.1 }, date: '2026-05-02',
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          rates: { ZAR: 23.2 }, date: '2026-05-02',
        }), { status: 200 }));

      const readings = await frankfurterFxSource.fetchLatest({ FRANKFURTER_BASE: 'https://fx.test' });
      expect(readings).not.toBeNull();
      expect(readings!.length).toBe(3);
      const usd = readings!.find((r) => r.signal_key === 'fx.usd_zar')!;
      expect(usd.value).toBe(18.5);
      expect(usd.unit).toBe('ZAR');
      expect(usd.category).toBe('fx');
      expect(usd.source_name).toBe('frankfurter.app');
      expect(fetchMock.mock.calls[0][0]).toBe('https://fx.test/latest?from=USD&to=ZAR');
    });

    it('skips a pair on HTTP error but still returns the others', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('boom', { status: 500 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 20.1 } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 23.2 } }), { status: 200 }));

      const readings = await frankfurterFxSource.fetchLatest({ FRANKFURTER_BASE: 'https://fx.test' });
      expect(readings!.length).toBe(2);
    });

    it('returns null when ALL pairs fail', async () => {
      fetchMock
        .mockResolvedValue(new Response('boom', { status: 500 }));
      const readings = await frankfurterFxSource.fetchLatest({ FRANKFURTER_BASE: 'https://fx.test' });
      expect(readings).toBeNull();
    });
  });

  describe('eiaOilSource', () => {
    it('returns null + logs when EIA_API_KEY missing (no fetch)', async () => {
      const readings = await eiaOilSource.fetchLatest({});
      expect(readings).toBeNull();
      expect(fetchMock.mock.calls.length).toBe(0);
    });

    it('fetches Brent spot + maps to ExternalSignalReading', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        response: { data: [{ period: '2026-05-01', value: 85.43 }] },
      }), { status: 200 }));

      const readings = await eiaOilSource.fetchLatest({
        EIA_API_KEY: 'test-key', EIA_BASE: 'https://eia.test',
      });
      expect(readings).not.toBeNull();
      expect(readings!.length).toBe(1);
      expect(readings![0].signal_key).toBe('oil.brent_spot');
      expect(readings![0].value).toBe(85.43);
      expect(readings![0].unit).toBe('USD/bbl');
      expect(readings![0].category).toBe('commodity');
      expect(fetchMock.mock.calls[0][0]).toContain('series][]=RBRTE');
      expect(fetchMock.mock.calls[0][0]).toContain('api_key=test-key');
    });

    it('returns null on HTTP error', async () => {
      fetchMock.mockResolvedValueOnce(new Response('rate limit', { status: 429 }));
      const readings = await eiaOilSource.fetchLatest({
        EIA_API_KEY: 'test-key', EIA_BASE: 'https://eia.test',
      });
      expect(readings).toBeNull();
    });
  });

  describe('worldBankMacroSource', () => {
    it('fetches SA CPI + GDP growth and maps to macro readings', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { page: 1 }, [{ date: '2025', value: 4.4 }],
        ]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify([
          { page: 1 }, [{ date: '2025', value: 1.1 }],
        ]), { status: 200 }));

      const readings = await worldBankMacroSource.fetchLatest({ WORLD_BANK_BASE: 'https://wb.test' });
      expect(readings).not.toBeNull();
      expect(readings!.length).toBe(2);
      expect(readings![0].signal_key).toBe('macro.za_cpi_inflation');
      expect(readings![0].value).toBe(4.4);
      expect(readings![0].category).toBe('macro');
      expect(readings![1].signal_key).toBe('macro.za_gdp_growth');
      expect(fetchMock.mock.calls[0][0]).toContain('/country/ZAF/indicator/FP.CPI.TOTL.ZG');
    });

    it('skips null-value points and returns null when nothing usable', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify([{ page: 1 }, [{ date: '2025', value: null }]]), { status: 200 }))
        .mockResolvedValueOnce(new Response('server error', { status: 500 }));
      expect(await worldBankMacroSource.fetchLatest({ WORLD_BANK_BASE: 'https://wb.test' })).toBeNull();
    });
  });

  describe('gdeltNewsSource', () => {
    it('maps real articles into one news reading with articles payload', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        articles: [
          { title: 'Rand slides on power cuts', url: 'https://news.test/a', seendate: '20260714T080000Z', domain: 'news.test' },
          { title: 'Mining exports up', url: 'https://news.test/b', seendate: '20260713T080000Z', domain: 'news.test' },
        ],
      }), { status: 200 }));

      const readings = await gdeltNewsSource.fetchLatest({ GDELT_BASE: 'https://gdelt.test' });
      expect(readings).not.toBeNull();
      expect(readings!.length).toBe(1);
      const r = readings![0];
      expect(r.category).toBe('news');
      expect(r.signal_key).toBe('news.za_economy');
      expect(r.value).toBe(2);
      expect(r.summary).toBe('Rand slides on power cuts');
      expect(r.articles).toEqual([
        { title: 'Rand slides on power cuts', url: 'https://news.test/a', date: '2026-07-14', domain: 'news.test' },
        { title: 'Mining exports up', url: 'https://news.test/b', date: '2026-07-13', domain: 'news.test' },
      ]);
    });

    it('returns null when no articles', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ articles: [] }), { status: 200 }));
      expect(await gdeltNewsSource.fetchLatest({ GDELT_BASE: 'https://gdelt.test' })).toBeNull();
    });
  });

  describe('sweepExternalSignals', () => {
    it('inserts a new signal per tenant; updates rather than duplicates on second sweep', async () => {
      // Sweep 1
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 18.5 } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 20.1 } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 23.2 } }), { status: 200 }));
      const r1 = await sweepExternalSignals(env.DB, { FRANKFURTER_BASE: 'https://fx.test' }, [frankfurterFxSource]);
      expect(r1.readingsFetched).toBe(3);
      // 2 tenants × 3 readings = 6 inserts
      expect(r1.signalsInserted).toBe(6);

      const countA = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(TENANT_A).first<{ n: number }>();
      expect(countA?.n).toBe(3);

      // Sweep 2 — same day, same value → unchanged (in-memory dedupe)
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 18.5 } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 20.1 } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 23.2 } }), { status: 200 }));
      const r2 = await sweepExternalSignals(env.DB, { FRANKFURTER_BASE: 'https://fx.test' }, [frankfurterFxSource]);
      expect(r2.signalsInserted).toBe(0);
      expect(r2.signalsUnchanged).toBe(6);

      const countAfter = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM external_signals WHERE tenant_id = ?`
      ).bind(TENANT_A).first<{ n: number }>();
      expect(countAfter?.n).toBe(3); // still 3 — UPDATE in place
    });

    it('appends to history when value changes; UPDATE replaces same-day', async () => {
      // Sweep 1 with value 18.5
      fetchMock.mockReset();
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ rates: { ZAR: 18.5 } }), { status: 200 }));
      await sweepExternalSignals(
        env.DB, { FRANKFURTER_BASE: 'https://fx.test' },
        [{
          name: 'test-fx', fetchLatest: async () => [{
            category: 'fx', source_name: 'test', signal_key: 'fx.usd_zar',
            title: 'USD/ZAR', summary: 'r1', value: 18.5, unit: 'ZAR',
          }],
        }],
      );

      // Sweep 2 — different value same day → updates in place
      await sweepExternalSignals(
        env.DB, {},
        [{
          name: 'test-fx', fetchLatest: async () => [{
            category: 'fx', source_name: 'test', signal_key: 'fx.usd_zar',
            title: 'USD/ZAR', summary: 'r2', value: 18.7, unit: 'ZAR',
          }],
        }],
      );

      const row = await env.DB.prepare(
        `SELECT raw_data FROM external_signals WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT 1`
      ).bind(TENANT_A).first<{ raw_data: string }>();
      const data = JSON.parse(row!.raw_data) as { latest_value: number; history: Array<{ date: string; value: number }> };
      expect(data.latest_value).toBe(18.7);
      expect(data.history.length).toBe(1); // same day → 1 history point (replaced)
    });

    it('skips a source that returns null without aborting others', async () => {
      const noopSource: ExternalSignalSource = {
        name: 'noop', fetchLatest: async () => null,
      };
      const liveSource: ExternalSignalSource = {
        name: 'live', fetchLatest: async () => [{
          category: 'fx', source_name: 'live', signal_key: 'fx.test',
          title: 'X', summary: 'X', value: 1, unit: 'X',
        }],
      };
      const r = await sweepExternalSignals(env.DB, {}, [noopSource, liveSource]);
      expect(r.sourcesAttempted).toBe(2);
      expect(r.sourcesSucceeded).toBe(1);
      expect(r.signalsInserted).toBe(2); // 2 tenants × 1 reading
    });

    it('survives a source that throws', async () => {
      const throwingSource: ExternalSignalSource = {
        name: 'broken', fetchLatest: async () => { throw new Error('boom'); },
      };
      const r = await sweepExternalSignals(env.DB, {}, [throwingSource]);
      expect(r.sourcesAttempted).toBe(1);
      expect(r.sourcesSucceeded).toBe(0);
      expect(r.readingsFetched).toBe(0);
    });
  });
});
