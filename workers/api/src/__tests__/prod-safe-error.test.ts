/**
 * prodSafeError — production responses must never leak internal exception
 * detail (D1 SQL fragments, stack hints, internal table names) to the client.
 * The full error is always logged server-side; only the client-facing `details`
 * field is sanitised, and only in production.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { prodSafeError } from '../services/http-errors';

// prodSafeError logs via console.error (structured logger). Silence it so the
// test output stays clean; we assert on the returned body, not the log line.
const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterEach(() => errSpy.mockClear());

describe('prodSafeError', () => {
  it('echoes the raw error detail outside production (staging/dev debugging)', () => {
    const body = prodSafeError(
      new Error('D1_ERROR: no such column: secret_field'),
      'staging',
      { error: 'Failed to list tenants' },
    );
    expect(body.error).toBe('Failed to list tenants');
    expect(body.details).toContain('no such column');
  });

  it('hides raw error detail in production', () => {
    const body = prodSafeError(
      new Error('D1_ERROR: no such column: secret_field'),
      'production',
      { error: 'Failed to list tenants' },
    );
    expect(body.error).toBe('Failed to list tenants');
    expect(body.details).not.toContain('secret_field');
    expect(body.details).not.toContain('D1_ERROR');
  });

  it('treats undefined ENVIRONMENT as non-production (matches codebase convention)', () => {
    const body = prodSafeError(new Error('boom'), undefined, { error: 'X' });
    expect(body.details).toContain('boom');
  });

  it('handles non-Error throwables without leaking in production', () => {
    const dev = prodSafeError('string failure', 'staging', { error: 'X' });
    expect(dev.details).toContain('string failure');
    const prod = prodSafeError('string failure', 'production', { error: 'X' });
    expect(prod.details).not.toContain('string failure');
  });

  it('always writes the full error to the server log, even in production', () => {
    prodSafeError(new Error('D1_ERROR: leak me'), 'production', { error: 'X', layer: 'admin' });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls[0][0] as string;
    expect(logged).toContain('leak me');
  });
});
