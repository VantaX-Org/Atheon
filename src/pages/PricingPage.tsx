/**
 * /pricing — public-facing pricing page.
 *
 * Lists the three plan tiers from /api/billing/plans. Public visitors
 * see "Start trial" CTAs that route to /trial. Logged-in trial-tier
 * users see "Upgrade" CTAs that POST /api/billing/checkout and redirect
 * to the Stripe Checkout URL.
 *
 * No auth required to view; the upgrade flow itself requires an active
 * tenant session.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Loader2, Sparkles } from "lucide-react";
import { api, ApiError, getToken } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { useTenantCurrency } from "@/stores/appStore";
import { formatFullCurrency } from "@/lib/format-currency";

type Plan = Awaited<ReturnType<typeof api.billing.plans>>['plans'][number];

const HIGHLIGHT_PLAN_ID = 'professional';

export function PricingPage(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const isAuthenticated = !!getToken();
  const currency = useTenantCurrency();

  useEffect(() => {
    api.billing.plans()
      .then(res => setPlans(res.plans))
      .catch(err => {
        toast.error('Failed to load plans', {
          message: err instanceof Error ? err.message : undefined,
          requestId: err instanceof ApiError ? err.requestId : null,
        });
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCheckout(planId: string) {
    if (checkoutLoading) return;
    if (!isAuthenticated) {
      // Public visitor — route to trial signup with the plan as a hint.
      navigate(`/trial?plan=${encodeURIComponent(planId)}`);
      return;
    }
    setCheckoutLoading(planId);
    try {
      const res = await api.billing.checkout({ plan_id: planId, billing_cycle: cycle });
      window.location.href = res.url;
    } catch (err) {
      toast.error('Checkout failed', {
        message: err instanceof Error ? err.message : 'Unable to start checkout',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
      setCheckoutLoading(null);
    }
  }

  return (
    <div className="min-h-screen px-6 py-16 max-w-6xl mx-auto" data-testid="pricing-page">
      {/* Editorial hero */}
      <div className="text-center mb-12">
        <p className="text-caption font-mono uppercase tracking-[0.22em] t-muted mb-4">
          Plans &amp; Pricing
        </p>
        <h1 className="text-[clamp(2.75rem,6vw,4.25rem)] font-bold tracking-tight t-primary leading-[1.02] mb-4">
          Pricing
        </h1>
        <p className="text-base t-muted max-w-2xl mx-auto leading-relaxed">
          Per-tenant pricing. The annual cycle bundles ~20% off vs monthly. No hidden enterprise tier —
          if you need more users or ERP connections, the Enterprise plan covers it.
        </p>
        {/* Billing-cycle toggle */}
        <div className="inline-flex items-center gap-1 mt-8 p-1 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-card)]">
          {(['monthly', 'annual'] as const).map(c => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] capitalize ${
                cycle === c ? 'bg-accent text-[var(--text-on-accent)] shadow-[var(--shadow-raised)]' : 't-secondary hover:t-primary'
              }`}
              data-testid={`cycle-${c}`}
            >
              {c}{c === 'annual' && <span className="ml-1.5 text-caption font-mono opacity-80">save ~20%</span>}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch max-w-5xl mx-auto">
          {plans.map(plan => {
            const price = cycle === 'annual' ? plan.price.annual : plan.price.monthly;
            const monthlyEquivalent = cycle === 'annual' ? Math.round(plan.price.annual / 12) : plan.price.monthly;
            const isHighlight = plan.id === HIGHLIGHT_PLAN_ID;
            return (
              <Card
                key={plan.id}
                className={`relative flex flex-col p-7 ${isHighlight ? 'border-accent/50 md:-mt-3 md:mb-3' : ''}`}
                style={
                  isHighlight
                    ? { background: 'var(--accent-subtle)', boxShadow: '0 0 0 1px rgb(var(--accent-rgb) / 0.25), var(--shadow-raised), 0 24px 60px -28px var(--accent-glow)' }
                    : undefined
                }
                data-testid={`plan-${plan.id}`}
              >
                {isHighlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="info" size="md" className="font-mono uppercase tracking-[0.14em] shadow-[var(--shadow-raised)]">
                      <Sparkles size={11} className="mr-1" /> Most popular
                    </Badge>
                  </div>
                )}

                {/* Eyebrow plan name */}
                <p className={`text-caption font-mono uppercase tracking-[0.18em] mb-1 ${isHighlight ? 'text-accent' : 't-muted'}`}>
                  {plan.name}
                </p>
                <p className="text-sm t-muted mb-6 min-h-[2.5rem] leading-snug">{plan.description}</p>

                {/* Hero price */}
                <div className="mb-1 flex items-baseline gap-1.5">
                  <span className="text-[2.75rem] leading-none font-bold font-mono tnum t-primary">
                    {formatFullCurrency(monthlyEquivalent, currency)}
                  </span>
                  <span className="text-sm font-mono t-muted">/ mo</span>
                </div>
                <div className="text-caption font-mono t-muted mb-6">
                  {cycle === 'annual' ? `billed annually ${formatFullCurrency(price, currency)}` : `billed monthly · ${plan.currency}`}
                </div>

                <div className="h-px w-full bg-[var(--border-card)] mb-6" />

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm t-secondary">
                      <Check size={15} className="text-accent flex-shrink-0 mt-0.5" />
                      <span className="leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  variant={isHighlight ? 'primary' : 'secondary'}
                  className="w-full"
                  onClick={() => startCheckout(plan.id)}
                  disabled={checkoutLoading === plan.id}
                  data-testid={`checkout-${plan.id}`}
                >
                  {checkoutLoading === plan.id ? (
                    <><Loader2 size={14} className="mr-2 animate-spin" /> Redirecting…</>
                  ) : isAuthenticated ? (
                    'Upgrade to ' + plan.name
                  ) : (
                    'Start free trial'
                  )}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-center mt-12 text-sm t-muted max-w-2xl mx-auto">
        Need something custom? Email{' '}
        <a href="mailto:sales@vantax.co.za" className="text-accent hover:underline font-medium">sales@vantax.co.za</a>{' '}
        — the Enterprise tier covers most asks, and we can build a private tier for unusual ones.
      </div>
    </div>
  );
}

export default PricingPage;
