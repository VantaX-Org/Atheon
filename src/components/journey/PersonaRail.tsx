/**
 * PersonaRail — persona-lens insight cards rendered under the JourneySpine
 * (spec 2026-07-14 §8.1). One rail for all seven personas: persona
 * differences are data, not code paths. Every ZAR shown is a finding's
 * gate-passed confirmed value; unverified values keep the existing
 * "Potential (unverified)" muted treatment (AssessmentFindingsPanel rule).
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api, type PersonaInsight, type PersonaInsightsResponse, type ExternalPulseChannel } from '@/lib/api';
import type { Persona, User, UserRole } from '@/types';
import { useAppStore, useTenantCurrency } from '@/stores/appStore';
import { formatCompactCurrency } from '@/lib/format-currency';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

// ponytail: App.tsx role cohorts aren't exported — every file re-declares its
// own list (same convention as Sidebar.tsx). This is MANAGER_ROLES.
const RAIL_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];

/** Human labels — the word "persona" never appears in UI copy (spec §8.2). */
// eslint-disable-next-line react-refresh/only-export-components
export const PERSONA_LABELS: Record<Persona, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  coo: 'COO',
  cpo: 'CPO — Procurement',
  cmo: 'CMO',
  chro: 'CHRO',
  cio: 'CIO',
};

/** Saved persona, else role-derived default (spec §3.1). Null = no rail. */
// eslint-disable-next-line react-refresh/only-export-components
export function defaultPersona(user: User | null): Persona | null {
  if (!user) return null;
  if (user.persona) return user.persona;
  if (user.role === 'executive' || user.role === 'board_member') return 'ceo';
  if (user.role === 'manager') return 'coo';
  return null;
}

const ARROW: Record<ExternalPulseChannel['direction'], string> = { up: '↑', down: '↓', flat: '→' };
const PULSE_LABEL: Record<string, string> = {
  'fx.usd_zar': 'ZAR/USD', 'oil.brent_spot': 'Brent',
  'macro.za_cpi_inflation': 'CPI', 'macro.za_gdp_growth': 'GDP',
};

function channelLine(c: ExternalPulseChannel): string {
  const label = PULSE_LABEL[c.signal_key] ?? c.signal_key;
  const move = c.change_pct != null ? `${ARROW[c.direction] ?? ''}${Math.abs(c.change_pct).toFixed(1)}%` : ARROW[c.direction] ?? '';
  return `${label} ${c.value} ${move}`.trim();
}

function pulseLine(p: NonNullable<PersonaInsightsResponse['external_pulse']>): string {
  const bits = [p.fx, p.brent, p.cpi, p.gdp].filter((c): c is ExternalPulseChannel => !!c).map(channelLine);
  if (p.news_latest) bits.push(`News: ${p.news_latest.title}`);
  if (p.regulatory_latest) bits.push(`Reg: ${p.regulatory_latest.title}`);
  return bits.join(' · ');
}

function PersonaInsightCard({ insight, currency }: { insight: PersonaInsight; currency: string }) {
  const unverified = insight.value_kind === 'potential_unverified';
  return (
    <Card className="p-4 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <StatusPill status={insight.severity} size="sm" />
        {unverified && <span className="text-caption t-muted">Potential (unverified)</span>}
      </div>
      {insight.value_zar !== null && (
        <p className={`mt-2 text-headline-xl tnum ${unverified ? 't-muted' : 't-primary'}`}>
          {formatCompactCurrency(insight.value_zar, currency)}
        </p>
      )}
      <p className="mt-1 text-sm font-medium t-primary">{insight.headline}</p>
      <p className="text-caption t-muted truncate">{insight.detail}</p>
      {insight.external_context && (
        <p className="mt-1 text-caption t-muted">
          {ARROW[insight.external_context.direction] ?? ''} {insight.external_context.signal}{' '}
          {insight.external_context.value} — {insight.external_context.note}
        </p>
      )}
      <Link
        to={insight.cta.route}
        className="mt-auto pt-3 text-caption font-medium text-accent inline-flex items-center gap-1 hover:underline"
      >
        {insight.cta.label} <ArrowRight size={11} aria-hidden="true" />
      </Link>
    </Card>
  );
}

export function PersonaRail({ user, fixedPersona }: { user: User | null; fixedPersona?: Persona }) {
  const toast = useToast();
  const setUser = useAppStore((s) => s.setUser);
  const currency = useTenantCurrency();
  const resolved = fixedPersona ?? defaultPersona(user);
  const [persona, setPersona] = useState<Persona | null>(resolved);
  const [data, setData] = useState<PersonaInsightsResponse | 'loading' | 'error'>('loading');
  const [savingDefault, setSavingDefault] = useState(false);

  // Store user can hydrate after first render — adopt the default once known.
  useEffect(() => { if (!persona && resolved) setPersona(resolved); }, [persona, resolved]);

  // Rail renders only for the executive/manager cohort with a resolvable
  // persona; fixedPersona (board digest) trusts the page's own route gate.
  const visible = !!persona && (fixedPersona ? true : !!user && RAIL_ROLES.includes(user.role));

  useEffect(() => {
    if (!visible || !persona) return;
    let cancelled = false;
    setData('loading');
    api.insights.get(persona)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData('error'); });
    return () => { cancelled = true; };
  }, [visible, persona]);

  if (!visible || !persona) return null;

  // Fetch failure collapses the rail to one quiet line — never a fake-empty
  // dashboard (spec §8.1).
  if (data === 'error') {
    // Honesty: we only know the fetch failed, not why — claim no cause.
    return <p className="mt-6 text-caption t-muted">Insights couldn't be loaded right now.</p>;
  }

  const saveDefault = async () => {
    if (!user) return;
    setSavingDefault(true);
    try {
      await api.auth.setPersona(persona);
      setUser({ ...user, persona });
    } catch {
      toast.error('Failed to save your default view');
    }
    setSavingDefault(false);
  };

  const loaded = data === 'loading' ? null : data;
  // CEO is a fixed 5-card set (spec §4.7); other personas rank up to 8.
  const insights = loaded ? loaded.insights.slice(0, persona === 'ceo' ? 5 : 8) : [];
  const grid = persona === 'ceo'
    ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3'
    : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3';

  return (
    <section aria-label="Your view" className="mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-3">
          <span className="text-label t-muted uppercase">Your view</span>
          {fixedPersona ? (
            <span className="text-sm font-semibold t-primary">{PERSONA_LABELS[persona]}</span>
          ) : (
            <>
              <select
                aria-label="Your view"
                value={persona}
                onChange={(e) => setPersona(e.target.value as Persona)}
                className="px-2 py-1 rounded-md border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
              >
                {(Object.keys(PERSONA_LABELS) as Persona[]).map((p) => (
                  <option key={p} value={p}>{PERSONA_LABELS[p]}</option>
                ))}
              </select>
              {user && persona !== user.persona && (
                <button
                  type="button"
                  disabled={savingDefault}
                  onClick={() => { void saveDefault(); }}
                  className="text-caption font-medium text-accent hover:underline disabled:opacity-50"
                >
                  Set as my default
                </button>
              )}
            </>
          )}
        </div>
        {loaded?.external_pulse && (
          <p className="text-caption t-muted truncate">{pulseLine(loaded.external_pulse)}</p>
        )}
      </div>

      {!loaded ? (
        <div className={grid} aria-hidden="true">
          {Array.from({ length: persona === 'ceo' ? 5 : 4 }).map((_, i) => <Skeleton key={i} variant="card" height={140} />)}
        </div>
      ) : !loaded.generated_from_assessment_id ? (
        <Link to="/onboarding" className="block group">
          <Card className="p-4 flex items-center justify-between gap-4" style={{ background: 'var(--accent-subtle)' }}>
            <div>
              <p className="t-primary font-medium">No analysis yet — your view starts with your data.</p>
              {/* Copy can't assume connection state — this renders both before
                  connect and after connect / before the first analysis. */}
              <p className="text-caption t-muted">Atheon builds your {PERSONA_LABELS[persona]} insights from your first completed analysis.</p>
            </div>
            <span className="text-caption font-medium text-accent inline-flex items-center gap-1 shrink-0">
              Get started <ArrowRight size={12} aria-hidden="true" />
            </span>
          </Card>
        </Link>
      ) : insights.length === 0 ? (
        // Honest empty state (spec §5.3.4): no gate-passed findings ≠ green.
        // ponytail: response carries no standalone unverified total when the
        // list is empty; unverified findings arrive as insights and keep
        // their muted treatment above.
        <Card className="p-4">
          <p className="text-sm t-muted">
            No confirmed findings in your area yet — Atheon surfaces them here as more data is verified.
          </p>
        </Card>
      ) : (
        <div className={grid} data-testid="persona-insights">
          {insights.map((i) => <PersonaInsightCard key={i.id} insight={i} currency={currency} />)}
        </div>
      )}
    </section>
  );
}
