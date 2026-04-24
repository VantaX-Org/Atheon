/**
 * Request-ID middleware + structured logger tests.
 *
 * Covers:
 *  - Fresh UUID generated when X-Request-ID is absent
 *  - Well-formed inbound X-Request-ID echoed back untouched
 *  - Malformed inbound X-Request-ID rejected; fresh UUID issued instead
 *  - Same request-ID is stable across middleware (auth 401 still has header)
 *  - logger emits a JSON envelope to console.log with expected shape
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { SELF } from 'cloudflare:test';
import { logInfo, logError } from '../services/logger';

/** Helper: call POST /api/v1/admin/migrate with the test SETUP_SECRET. */
async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) {
    throw new Error(`Migration endpoint returned ${res.status}`);
  }
}

describe('Request-ID middleware', () => {
  beforeAll(async () => {
    await migrateViaEndpoint();
  });

  it('generates a fresh UUID-shaped X-Request-ID when header is absent', async () => {
    const res = await SELF.fetch('http://localhost/healthz');
    const id = res.headers.get('X-Request-ID');
    expect(id).toBeTruthy();
    // crypto.randomUUID() produces canonical 8-4-4-4-12 lowercase hex
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('echoes a well-formed inbound X-Request-ID back on the response', async () => {
    const inbound = 'req-abcDEF12345_test-67890';
    const res = await SELF.fetch('http://localhost/healthz', {
      headers: { 'X-Request-ID': inbound },
    });
    expect(res.headers.get('X-Request-ID')).toBe(inbound);
  });

  it('rejects a malformed inbound X-Request-ID and issues a fresh UUID', async () => {
    // Contains a space — fails the [a-zA-Z0-9_-]{8,64} pattern
    const malformed = 'has space injection';
    const res = await SELF.fetch('http://localhost/healthz', {
      headers: { 'X-Request-ID': malformed },
    });
    const returned = res.headers.get('X-Request-ID');
    expect(returned).not.toBe(malformed);
    expect(returned).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('rejects inbound X-Request-ID longer than 64 chars', async () => {
    const tooLong = 'a'.repeat(65);
    const res = await SELF.fetch('http://localhost/healthz', {
      headers: { 'X-Request-ID': tooLong },
    });
    const returned = res.headers.get('X-Request-ID');
    expect(returned).not.toBe(tooLong);
    expect(returned).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('still attaches X-Request-ID on protected routes that 401 before the handler runs', async () => {
    // /api/v1/catalysts requires auth — returns 401 through middleware chain.
    // Middleware must still append the header on the response.
    const inbound = 'req-401test_abcdefg1234';
    const res = await SELF.fetch('http://localhost/api/v1/catalysts', {
      headers: { 'X-Request-ID': inbound },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('X-Request-ID')).toBe(inbound);
  });
});

describe('Structured logger', () => {
  it('emits a JSON envelope to console.log for info-level records', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logInfo('test.message', {
        requestId: 'req-logger-test-abc123',
        tenantId: 'tenant-x',
        layer: 'auth',
        action: 'test.event',
      }, { foo: 'bar', count: 42 });

      expect(spy).toHaveBeenCalledTimes(1);
      const [line] = spy.mock.calls[0];
      expect(typeof line).toBe('string');
      const record = JSON.parse(line as string);
      expect(record.level).toBe('info');
      expect(record.msg).toBe('test.message');
      expect(record.ctx.requestId).toBe('req-logger-test-abc123');
      expect(record.ctx.tenantId).toBe('tenant-x');
      expect(record.ctx.layer).toBe('auth');
      expect(record.data).toEqual({ foo: 'bar', count: 42 });
      expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    } finally {
      spy.mockRestore();
    }
  });

  it('emits err envelope with name/message/stack for error-level records', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const thrown = new Error('boom');
      logError('test.failure', thrown, { requestId: 'req-err-test-xyz98765', layer: 'catalysts' });

      expect(spy).toHaveBeenCalledTimes(1);
      const record = JSON.parse(spy.mock.calls[0][0] as string);
      expect(record.level).toBe('error');
      expect(record.err?.name).toBe('Error');
      expect(record.err?.message).toBe('boom');
      expect(record.err?.stack).toContain('boom');
    } finally {
      spy.mockRestore();
    }
  });
});
