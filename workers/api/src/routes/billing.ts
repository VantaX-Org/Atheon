/**
 * SPEC-009: Billing & Subscription Management (Stripe integration)
 * Handles subscription lifecycle, checkout, portal, webhooks, and usage metering.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const billing = new Hono<AppBindings>();

// ─── Plan Definitions ───────────────────────────────────────
const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'For small teams getting started with business intelligence',
    price: { monthly: 49, annual: 470 },
    currency: 'USD',
    features: ['Up to 5 users', '1 ERP connection', 'Basic dashboards', 'Email support'],
    limits: { users: 5, erpConnections: 1, catalystClusters: 3, storageGb: 5 },
  },
  {
    id: 'professional',
    name: 'Professional',
    description: 'For growing businesses needing advanced analytics',
    price: { monthly: 149, annual: 1430 },
    currency: 'USD',
    features: ['Up to 25 users', '5 ERP connections', 'Advanced analytics', 'Priority support', 'Custom catalysts'],
    limits: { users: 25, erpConnections: 5, catalystClusters: 10, storageGb: 50 },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For large organizations with complex requirements',
    price: { monthly: 499, annual: 4790 },
    currency: 'USD',
    features: ['Unlimited users', 'Unlimited ERP connections', 'Full platform access', 'Dedicated support', 'SLA guarantee', 'Custom integrations'],
    limits: { users: -1, erpConnections: -1, catalystClusters: -1, storageGb: 500 },
  },
];

// GET /api/billing/plans - List available plans
billing.get('/plans', async (c) => {
  return c.json({ plans: PLANS });
});

// GET /api/billing/subscription - Get current subscription
billing.get('/subscription', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;

  const subscription = await c.env.DB.prepare(
    'SELECT * FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!subscription) {
    return c.json({
      subscription: null,
      plan: PLANS[0], // Default to starter
      status: 'trialing',
      message: 'No active subscription. Using free trial.',
    });
  }

  const plan = PLANS.find(p => p.id === subscription.plan_id) || PLANS[0];

  return c.json({
    subscription: {
      id: subscription.id,
      planId: subscription.plan_id,
      status: subscription.status,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      cancelAtPeriodEnd: subscription.cancel_at_period_end === 1,
      stripeSubscriptionId: subscription.stripe_subscription_id,
      stripeCustomerId: subscription.stripe_customer_id,
      createdAt: subscription.created_at,
    },
    plan,
  });
});

// POST /api/billing/checkout - Create checkout session
billing.post('/checkout', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const { data: body, errors } = await getValidatedJsonBody<{
    plan_id: string;
    billing_cycle: string;
    success_url?: string;
    cancel_url?: string;
  }>(c, [
    { field: 'plan_id', type: 'string', required: true },
    { field: 'billing_cycle', type: 'string', required: true },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const plan = PLANS.find(p => p.id === body.plan_id);
  if (!plan) {
    return c.json({ error: 'Invalid plan' }, 400);
  }

  // Create or retrieve Stripe customer
  const tenant = await c.env.DB.prepare(
    'SELECT * FROM tenants WHERE id = ?'
  ).bind(auth.tenantId).first();

  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  // Store checkout intent for webhook processing
  const checkoutId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO billing_checkouts (id, tenant_id, plan_id, billing_cycle, status, created_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(checkoutId, auth.tenantId, body.plan_id, body.billing_cycle, 'pending').run().catch(() => {
    // Table may not exist yet — non-fatal
  });

  // In production, this would create a Stripe Checkout Session
  // For now, return a checkout URL structure
  const price = body.billing_cycle === 'annual' ? plan.price.annual : plan.price.monthly;

  return c.json({
    checkoutId,
    planId: body.plan_id,
    billingCycle: body.billing_cycle,
    amount: price,
    currency: plan.currency,
    // In production: url would be Stripe Checkout Session URL
    message: 'Checkout session created. Stripe integration pending configuration.',
  }, 201);
});

// POST /api/billing/portal - Create billing portal session
billing.post('/portal', async (c) => {
  const auth = c.get('auth') as AuthContext;

  const subscription = await c.env.DB.prepare(
    'SELECT stripe_customer_id FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(auth.tenantId).first<{ stripe_customer_id: string }>();

  if (!subscription?.stripe_customer_id) {
    return c.json({ error: 'No active subscription found' }, 404);
  }

  // In production: create Stripe Billing Portal session
  return c.json({
    message: 'Billing portal session. Stripe integration pending configuration.',
    customerId: subscription.stripe_customer_id,
  });
});

// POST /api/billing/cancel - Cancel subscription
billing.post('/cancel', async (c) => {
  const auth = c.get('auth') as AuthContext;

  await c.env.DB.prepare(
    'UPDATE subscriptions SET cancel_at_period_end = 1 WHERE tenant_id = ? AND status = ?'
  ).bind(auth.tenantId, 'active').run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), auth.tenantId, auth.userId, 'subscription_cancel', 'billing', 'subscription', '{}', 'success').run();

  return c.json({ success: true, message: 'Subscription will cancel at end of current period.' });
});

// GET /api/billing/usage - Get usage metrics
billing.get('/usage', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const tenantId = auth.tenantId;

  const [userCount, erpCount, clusterCount] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM erp_connections WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
  ]);

  return c.json({
    usage: {
      users: userCount?.count || 0,
      erpConnections: erpCount?.count || 0,
      catalystClusters: clusterCount?.count || 0,
    },
    updatedAt: new Date().toISOString(),
  });
});

// GET /api/billing/invoices - List invoices
billing.get('/invoices', async (c) => {
  const auth = c.get('auth') as AuthContext;

  const invoices = await c.env.DB.prepare(
    'SELECT * FROM billing_invoices WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(auth.tenantId).all().catch(() => ({ results: [] }));

  return c.json({
    invoices: (invoices.results || []).map((inv: Record<string, unknown>) => ({
      id: inv.id,
      amount: inv.amount,
      currency: inv.currency,
      status: inv.status,
      periodStart: inv.period_start,
      periodEnd: inv.period_end,
      paidAt: inv.paid_at,
      invoiceUrl: inv.invoice_url,
      createdAt: inv.created_at,
    })),
  });
});

// POST /api/billing/webhook - Stripe webhook handler
billing.post('/webhook', async (c) => {
  // In production: verify Stripe signature
  const body = await c.req.json<{ type: string; data: { object: Record<string, unknown> } }>();

  switch (body.type) {
    case 'checkout.session.completed': {
      const session = body.data.object;
      const tenantId = session.client_reference_id as string;
      const subscriptionId = session.subscription as string;
      const customerId = session.customer as string;

      if (tenantId && subscriptionId) {
        await c.env.DB.prepare(
          'INSERT OR REPLACE INTO subscriptions (id, tenant_id, stripe_subscription_id, stripe_customer_id, plan_id, status, current_period_start, current_period_end, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'), datetime(\'now\', \'+30 days\'), datetime(\'now\'))'
        ).bind(crypto.randomUUID(), tenantId, subscriptionId, customerId, 'professional', 'active').run();
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = body.data.object;
      await c.env.DB.prepare(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?'
      ).bind(sub.status, sub.id).run();
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = body.data.object;
      await c.env.DB.prepare(
        'UPDATE subscriptions SET status = ? WHERE stripe_subscription_id = ?'
      ).bind('canceled', sub.id).run();
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = body.data.object;
      const sub = await c.env.DB.prepare(
        'SELECT tenant_id FROM subscriptions WHERE stripe_customer_id = ?'
      ).bind(invoice.customer).first<{ tenant_id: string }>();
      if (sub) {
        await c.env.DB.prepare(
          'UPDATE subscriptions SET status = ? WHERE tenant_id = ?'
        ).bind('past_due', sub.tenant_id).run();
      }
      break;
    }
  }

  return c.json({ received: true });
});

export default billing;
