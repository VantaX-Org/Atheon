// TASK-021: Stripe billing integration for subscription management

interface StripeConfig {
  secret_key: string;
  webhook_secret: string;
  price_ids: {
    starter: string;
    professional: string;
    enterprise: string;
  };
}

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest<T>(
  secretKey: string,
  method: string,
  endpoint: string,
  body?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const response = await fetch(`${STRIPE_API}${endpoint}`, {
    method,
    headers,
    body: body ? new URLSearchParams(body).toString() : undefined,
  });

  if (!response.ok) {
    const error = await response.json() as { error?: { message?: string } };
    throw new Error(`Stripe API error: ${error.error?.message || response.status}`);
  }

  return await response.json() as T;
}

/**
 * Create a Stripe customer for a tenant
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export async function createCustomer(
  config: StripeConfig,
  tenantName: string,
  email: string,
  tenantId: string,
): Promise<{ customerId: string }> {
  const customer = await stripeRequest<{ id: string }>(
    config.secret_key,
    'POST',
    '/customers',
    {
      name: tenantName,
      email,
      'metadata[tenant_id]': tenantId,
    },
  );
  return { customerId: customer.id };
}

/**
 * Create a checkout session for subscription
 */
export async function createCheckoutSession(
  config: StripeConfig,
  customerId: string,
  plan: 'starter' | 'professional' | 'enterprise',
  successUrl: string,
  cancelUrl: string,
): Promise<{ sessionId: string; url: string }> {
  const priceId = config.price_ids[plan];
  if (!priceId) throw new Error(`Unknown plan: ${plan}`);

  const session = await stripeRequest<{ id: string; url: string }>(
    config.secret_key,
    'POST',
    '/checkout/sessions',
    {
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
    },
  );

  return { sessionId: session.id, url: session.url };
}

/**
 * Create a billing portal session for managing subscription
 */
export async function createPortalSession(
  config: StripeConfig,
  customerId: string,
  returnUrl: string,
): Promise<{ url: string }> {
  const session = await stripeRequest<{ url: string }>(
    config.secret_key,
    'POST',
    '/billing_portal/sessions',
    {
      customer: customerId,
      return_url: returnUrl,
    },
  );

  return { url: session.url };
}

/**
 * Get subscription status for a customer
 */
export async function getSubscription(
  config: StripeConfig,
  customerId: string,
): Promise<{
  id: string;
  status: string;
  plan: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
} | null> {
  const subs = await stripeRequest<{
    data: Array<{
      id: string;
      status: string;
      items: { data: Array<{ price: { id: string; nickname: string } }> };
      current_period_end: number;
      cancel_at_period_end: boolean;
    }>;
  }>(config.secret_key, 'GET', `/subscriptions?customer=${customerId}&status=active&limit=1`);

  const sub = subs.data[0];
  if (!sub) return null;

  return {
    id: sub.id,
    status: sub.status,
    plan: sub.items.data[0]?.price?.nickname || 'unknown',
    current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

/**
 * Verify Stripe webhook signature
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string,
): Promise<boolean> {
  const parts = signature.split(',');
  const timestampPart = parts.find(p => p.startsWith('t='));
  const signaturePart = parts.find(p => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) return false;

  const timestamp = timestampPart.split('=')[1];
  const expectedSig = signaturePart.split('=')[1];

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestamp}.${payload}`),
  );

  const computedSig = Array.from(new Uint8Array(signed))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(computedSig, expectedSig);
}
