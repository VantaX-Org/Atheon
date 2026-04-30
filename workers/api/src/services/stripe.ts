/**
 * Stripe REST helpers — Checkout Session creation + webhook signature verify.
 *
 * No Stripe SDK is used. The official `stripe` npm package depends on Node
 * built-ins that don't run cleanly under Workers; the REST surface is small
 * enough that a hand-rolled adapter is preferable.
 *
 * The two surfaces we need:
 *   1. POST /v1/checkout/sessions — convert a logged-in trial tenant to paid
 *   2. Stripe-Signature verification — protect the webhook handler from
 *      forged events
 *
 * Both are implemented against the documented Stripe API contract. No
 * hidden state, no external deps.
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface StripePrice {
  /** Stripe price id, e.g. price_1Pxyz… */
  priceId: string;
}

interface CheckoutSession {
  id: string;
  url: string;
}

/** Fallback test-mode price IDs. Real IDs come from STRIPE_PRICE_MAP env. */
const FALLBACK_PRICE_MAP: Record<string, string> = {
  // Test-mode placeholders. Override in env for real deployments.
  'starter:monthly':      'price_test_starter_monthly',
  'starter:annual':       'price_test_starter_annual',
  'professional:monthly': 'price_test_professional_monthly',
  'professional:annual':  'price_test_professional_annual',
  'enterprise:monthly':   'price_test_enterprise_monthly',
  'enterprise:annual':    'price_test_enterprise_annual',
};

/** Resolve plan + billing cycle to a Stripe price id, env-overridable. */
export function resolvePriceId(planId: string, billingCycle: 'monthly' | 'annual', priceMapJson?: string): StripePrice | null {
  const key = `${planId}:${billingCycle}`;
  let priceId: string | undefined;
  if (priceMapJson) {
    try {
      const parsed = JSON.parse(priceMapJson) as Record<string, string>;
      priceId = parsed[key];
    } catch {
      // Bad JSON in env — fall through to fallback.
    }
  }
  if (!priceId) priceId = FALLBACK_PRICE_MAP[key];
  if (!priceId) return null;
  return { priceId };
}

/**
 * Create a Stripe Checkout Session. Returns the session id + URL.
 * Throws on Stripe API error so callers can return 502 to the user.
 */
export async function createCheckoutSession(opts: {
  apiKey: string;
  priceId: string;
  tenantId: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
}): Promise<CheckoutSession> {
  const params = new URLSearchParams();
  params.set('mode', 'subscription');
  params.set('line_items[0][price]', opts.priceId);
  params.set('line_items[0][quantity]', '1');
  params.set('success_url', opts.successUrl);
  params.set('cancel_url', opts.cancelUrl);
  params.set('client_reference_id', opts.tenantId);
  if (opts.customerEmail) params.set('customer_email', opts.customerEmail);
  // Metadata travels with the session and lands on the webhook so we can
  // resolve the plan without re-querying our DB.
  if (opts.metadata) {
    for (const [k, v] of Object.entries(opts.metadata)) {
      params.set(`metadata[${k}]`, v);
    }
  }

  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Stripe Checkout creation failed: HTTP ${res.status} ${text.slice(0, 256)}`);
  }
  const session = await res.json() as { id: string; url: string };
  if (!session.url || !session.id) {
    throw new Error('Stripe returned a Checkout Session with no url/id');
  }
  return { id: session.id, url: session.url };
}

/**
 * Verify a Stripe webhook signature using the `whsec_…` signing secret.
 *
 * Stripe sends a `Stripe-Signature` header of the form:
 *   `t=1234567890,v1=hexsig,v1=hexsig,v0=…`
 *
 * The signature is HMAC-SHA256 of `t + "." + bodyText` using the secret.
 * Stripe rotates and may include multiple v1 signatures during overlap;
 * we accept the request if ANY v1 matches.
 *
 * Defaults: 5-minute tolerance window on `t`.
 */
export async function verifyWebhookSignature(opts: {
  bodyText: string;
  signatureHeader: string;
  secret: string;
  toleranceSeconds?: number;
}): Promise<{ valid: boolean; reason?: string }> {
  const tolerance = opts.toleranceSeconds ?? 300;
  if (!opts.signatureHeader) return { valid: false, reason: 'missing signature header' };

  // Parse the header into a map of scheme → value(s).
  const parts = opts.signatureHeader.split(',').map(s => s.trim());
  let timestampStr: string | null = null;
  const v1Signatures: string[] = [];
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 0) continue;
    const k = p.slice(0, eq);
    const v = p.slice(eq + 1);
    if (k === 't') timestampStr = v;
    else if (k === 'v1') v1Signatures.push(v);
  }
  if (!timestampStr || v1Signatures.length === 0) {
    return { valid: false, reason: 'malformed signature header' };
  }
  const timestamp = parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'non-numeric timestamp' };
  const nowS = Math.floor(Date.now() / 1000);
  if (Math.abs(nowS - timestamp) > tolerance) {
    return { valid: false, reason: `timestamp outside tolerance (${nowS - timestamp}s)` };
  }

  const signedPayload = `${timestamp}.${opts.bodyText}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(opts.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload) as BufferSource);
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  // Constant-time-ish compare (length-equal first, then full scan).
  for (const provided of v1Signatures) {
    if (provided.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < expected.length; i++) {
        diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
      }
      if (diff === 0) return { valid: true };
    }
  }
  return { valid: false, reason: 'no v1 signature matched' };
}

export const _testExports = { FALLBACK_PRICE_MAP };
