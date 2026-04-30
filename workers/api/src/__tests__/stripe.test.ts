/**
 * Stripe service tests — price resolution + webhook signature verification.
 *
 * createCheckoutSession is not exercised here because it requires the live
 * Stripe API; the contract is tested in integration against Stripe's test
 * mode separately. These tests cover the parts that have to be correct on
 * every commit:
 *
 *   - resolvePriceId honours STRIPE_PRICE_MAP when present
 *   - resolvePriceId falls back to the hardcoded test-mode map otherwise
 *   - verifyWebhookSignature accepts a freshly-signed body
 *   - verifyWebhookSignature rejects: tampered body, expired timestamp,
 *     wrong secret, malformed header, missing v1 entries
 */
import { describe, it, expect } from 'vitest';
import { resolvePriceId, verifyWebhookSignature, _testExports } from '../services/stripe';

const SECRET = 'whsec_test_unit_secret_value';

async function signWith(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`) as BufferSource);
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('Stripe resolvePriceId', () => {
  it('returns the env-mapped price id when STRIPE_PRICE_MAP is set', () => {
    const env = JSON.stringify({
      'starter:monthly': 'price_real_starter_monthly_42',
    });
    const res = resolvePriceId('starter', 'monthly', env);
    expect(res?.priceId).toBe('price_real_starter_monthly_42');
  });

  it('falls back to the hardcoded test-mode map when env is absent', () => {
    const res = resolvePriceId('professional', 'annual');
    expect(res?.priceId).toBe(_testExports.FALLBACK_PRICE_MAP['professional:annual']);
  });

  it('falls back to the test-mode map when env JSON is malformed', () => {
    const res = resolvePriceId('starter', 'monthly', 'not-valid-json{');
    expect(res?.priceId).toBe(_testExports.FALLBACK_PRICE_MAP['starter:monthly']);
  });

  it('returns null for an unknown plan or cycle', () => {
    expect(resolvePriceId('nonexistent', 'monthly')).toBeNull();
  });
});

describe('Stripe verifyWebhookSignature', () => {
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123' } } });

  it('accepts a freshly-signed valid body', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signWith(SECRET, ts, body);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts},v1=${sig}`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(true);
  });

  it('accepts a header containing extra non-v1 schemes', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signWith(SECRET, ts, body);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts},v0=ignored,v1=${sig},v2=future`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(true);
  });

  it('accepts when one of multiple v1 signatures matches (key rotation)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const goodSig = await signWith(SECRET, ts, body);
    const badSig = 'a'.repeat(goodSig.length);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts},v1=${badSig},v1=${goodSig}`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signWith(SECRET, ts, body);
    const verdict = await verifyWebhookSignature({
      bodyText: body + 'tampered',
      signatureHeader: `t=${ts},v1=${sig}`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/no v1 signature matched/);
  });

  it('rejects a timestamp outside the tolerance window', async () => {
    const ts = Math.floor(Date.now() / 1000) - 600; // 10 min old
    const sig = await signWith(SECRET, ts, body);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts},v1=${sig}`,
      secret: SECRET,
      toleranceSeconds: 300,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/timestamp outside tolerance/);
  });

  it('rejects when the signing secret is wrong', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signWith('whsec_wrong_secret', ts, body);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts},v1=${sig}`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(false);
  });

  it('rejects a malformed header (no v1)', async () => {
    const ts = Math.floor(Date.now() / 1000);
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: `t=${ts}`,
      secret: SECRET,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/malformed/);
  });

  it('rejects an empty header', async () => {
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: '',
      secret: SECRET,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/missing/);
  });

  it('rejects a non-numeric timestamp', async () => {
    const verdict = await verifyWebhookSignature({
      bodyText: body,
      signatureHeader: 't=abc,v1=deadbeef',
      secret: SECRET,
    });
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toMatch(/non-numeric/);
  });
});
