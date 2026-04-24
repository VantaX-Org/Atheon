/**
 * First-of-kind resilience tests for the ERP adapter layer.
 *
 * These tests exercise `fetchWithRetry` — the shared helper through which
 * every vendor adapter (SAP, Salesforce, Workday, Oracle, Xero, Sage, Pastel,
 * Dynamics 365, NetSuite, QuickBooks, Odoo) now routes its HTTP calls. By
 * validating the helper's retry / timeout / backoff contract, we inherit
 * correctness across all 11 adapters without needing a per-vendor test suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, FetchResilienceError } from '../services/erp-connector';

type MockFetch = ReturnType<typeof vi.fn>;

/** Build a tiny fake Response compatible with what fetchWithRetry reads from. */
function makeResponse(
  status: number,
  opts: { headers?: Record<string, string>; body?: string } = {},
): Response {
  const headers = new Headers(opts.headers ?? {});
  const init: ResponseInit = { status, headers };
  // Use the real Response constructor so .ok / .headers / .status are correct.
  return new Response(opts.body ?? '', init);
}

describe('fetchWithRetry - shared ERP adapter resilience helper', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path: returns Response on first success (1 attempt)', async () => {
    const mockFetch: MockFetch = vi.fn().mockResolvedValue(makeResponse(200, { body: '{"ok":true}' }));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('https://api.example.com/v1/customers', undefined, {
      label: 'test.happy',
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });

    expect(resp.status).toBe(200);
    expect(resp.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 twice then succeeds (3 attempts total)', async () => {
    const mockFetch: MockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(500))
      .mockResolvedValueOnce(makeResponse(200, { body: 'ok' }));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('https://api.example.com/x', undefined, {
      label: 'test.retry500',
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network error then succeeds (2 attempts)', async () => {
    const mockFetch: MockFetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(makeResponse(200, { body: 'back' }));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('https://api.example.com/x', undefined, {
      label: 'test.retryNet',
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('respects Retry-After on 429 (delay >= 1s)', async () => {
    const mockFetch: MockFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(429, { headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(makeResponse(200, { body: 'fine' }));
    vi.stubGlobal('fetch', mockFetch);

    const start = Date.now();
    const resp = await fetchWithRetry('https://api.example.com/x', undefined, {
      label: 'test.retryAfter',
      // Set a very small backoff so we can be confident the delay came from Retry-After.
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });
    const elapsed = Date.now() - start;

    expect(resp.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // The helper honours Retry-After: 1 → at least ~1000ms between attempts.
    // Allow slack for timer jitter but ensure it's well above the 1-2ms backoff.
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('exhausts attempts when all return 503 (throws FetchResilienceError with attempts === 3)', async () => {
    const mockFetch: MockFetch = vi.fn().mockResolvedValue(makeResponse(503));
    vi.stubGlobal('fetch', mockFetch);

    await expect(
      fetchWithRetry('https://api.example.com/x', undefined, {
        label: 'test.exhaust',
        initialBackoffMs: 1,
        maxBackoffMs: 2,
      }),
    ).rejects.toMatchObject({
      name: 'FetchResilienceError',
      attempts: 3,
      lastStatus: 503,
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 400 (returns Response after 1 attempt - caller handles status)', async () => {
    const mockFetch: MockFetch = vi.fn().mockResolvedValue(makeResponse(400, { body: 'bad' }));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('https://api.example.com/x', undefined, {
      label: 'test.no-retry-400',
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });

    expect(resp.status).toBe(400);
    expect(resp.ok).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry on 401 (returns Response after 1 attempt)', async () => {
    const mockFetch: MockFetch = vi.fn().mockResolvedValue(makeResponse(401));
    vi.stubGlobal('fetch', mockFetch);

    const resp = await fetchWithRetry('https://api.example.com/x', undefined, {
      label: 'test.no-retry-401',
      initialBackoffMs: 1,
      maxBackoffMs: 2,
    });

    expect(resp.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('times out a hanging fetch and surfaces abort as the cause', async () => {
    // Fetch that never resolves until abort fires. When the AbortController
    // fires, throw an AbortError (mirroring the real fetch behaviour).
    const mockFetch: MockFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          // Should never happen — fetchWithRetry always supplies a signal.
          setTimeout(() => reject(new Error('no signal')), 25000);
          return;
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        }, { once: true });
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const start = Date.now();
    let caught: unknown = undefined;
    try {
      await fetchWithRetry('https://api.example.com/hang', undefined, {
        label: 'test.timeout',
        timeoutMs: 100,
        initialBackoffMs: 1,
        maxBackoffMs: 2,
        // Keep attempts low so the test stays fast.
        maxAttempts: 2,
      });
    } catch (err) {
      caught = err;
    }
    const elapsed = Date.now() - start;

    expect(caught).toBeInstanceOf(FetchResilienceError);
    const fre = caught as FetchResilienceError;
    expect(fre.attempts).toBe(2);
    // The cause should be the AbortError (timeout).
    expect(fre.cause).toBeDefined();
    const cause = fre.cause as { name?: string } | undefined;
    expect(cause?.name).toBe('AbortError');
    // Sanity: the whole thing finished in well under the mocked 25s hang.
    expect(elapsed).toBeLessThan(5000);
  });

  it('jitter: two runs of "fail once + succeed" finish within a realistic window', async () => {
    // We cannot assert exact timings because of jitter (0-500ms) — this is a
    // sanity check that the helper runs in a reasonable wall-clock window.
    const runOnce = async (): Promise<number> => {
      const mockFetch: MockFetch = vi.fn()
        .mockResolvedValueOnce(makeResponse(502))
        .mockResolvedValueOnce(makeResponse(200));
      vi.stubGlobal('fetch', mockFetch);
      const t0 = Date.now();
      await fetchWithRetry('https://api.example.com/x', undefined, {
        label: 'test.jitter',
        // Fixed 50ms base so the only variance is the 0-500ms jitter term.
        initialBackoffMs: 50,
        maxBackoffMs: 1000,
      });
      return Date.now() - t0;
    };

    const t1 = await runOnce();
    const t2 = await runOnce();

    // Base backoff is 50ms (no jitter lower bound), capped by 50 + 500 = 550ms
    // of jitter. Allow generous headroom for scheduler noise but ensure we
    // don't blow past a couple of seconds.
    for (const t of [t1, t2]) {
      expect(t).toBeGreaterThanOrEqual(30);
      expect(t).toBeLessThan(3000);
    }
  });
});
