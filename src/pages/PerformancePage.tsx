/**
 * /legal/performance — public load-test datasheet (Phase BD).
 *
 * Procurement gate at 3000+ headcount: vendor risk teams want hard
 * numbers on latency, throughput, and error rate before they sign.
 * This page publishes the real numbers from our load-test harness
 * (scripts/load-test.mjs) so they don't have to ask.
 *
 * Honesty notes:
 *   - These are measured numbers, not aspirational SLO targets
 *   - We document the methodology (VUs, duration, fixtures) so
 *     the numbers are reproducible
 *   - We disclose discovered + fixed regressions so the procurement
 *     team sees engineering hygiene, not perfect-day cherry-picking
 *   - We separate "expected response" (e.g. 401 from an unauthed
 *     SCIM probe) from operational failure — 401 at 355 RPS is a
 *     STRENGTH signal, not a weakness
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import {
  Activity, CheckCircle2, ArrowLeft, ExternalLink, AlertTriangle, GitCommit,
} from 'lucide-react';

interface Run {
  label: string;
  endpoint: string;
  vus: number;
  durationSec: number;
  requestsTotal: number;
  errorRatePct: number;
  throughputRps: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  description: string;
  significance: 'pass' | 'note' | 'discovery';
}

// Numbers from /load-test-results/{healthz-postfix,api-status,scim-discovery}.json
// Captured 2026-05-15 against production atheon-api.vantax.co.za. The
// /healthz "before" data point reflects the pre-fix v74 cache-write race —
// included so the procurement audit trail shows the bug was caught + fixed.
const RUNS: Run[] = [
  {
    label: 'Health probe',
    endpoint: 'GET /healthz',
    vus: 10,
    durationSec: 30.3,
    requestsTotal: 812,
    errorRatePct: 0,
    throughputRps: 26.8,
    p50Ms: 348,
    p95Ms: 380,
    p99Ms: 1759,
    description: 'Full health check including D1 SELECT 1 probe + KV read. Throttled-write design absorbs continuous external monitoring without self-DoS.',
    significance: 'pass',
  },
  {
    label: 'Public status endpoint',
    endpoint: 'GET /api/status',
    vus: 5,
    durationSec: 30.9,
    requestsTotal: 97,
    errorRatePct: 0,
    throughputRps: 3.1,
    p50Ms: 1459,
    p95Ms: 2724,
    p99Ms: 2889,
    description: '3 D1 queries + KV-derived component status. Latency dominated by the D1 cold-query path. Zero errors at sustained 5-VU load.',
    significance: 'note',
  },
  {
    label: 'SCIM auth rejection (expected 401)',
    endpoint: 'GET /scim/v2/ServiceProviderConfig (no bearer)',
    vus: 10,
    durationSec: 14.1,
    requestsTotal: 5000,
    errorRatePct: 0,  // expected behaviour — 401 is the right answer
    throughputRps: 355.8,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    description: 'Sustained 355 req/s of unauthenticated probes against the SCIM endpoint returned the correct 401 from the bearer-token middleware. Demonstrates the auth path handles abusive traffic without backpressure.',
    significance: 'pass',
  },
];

// Caught + fixed during this load-test pass — surfaced so procurement
// sees engineering hygiene, not curated numbers.
const REGRESSIONS = [
  {
    discovered: '2026-05-15',
    fix: 'PR #466 (Phase BD-1)',
    summary: '/healthz wrote to a single KV key on every probe. Cloudflare KV rate-limits writes to 1/sec/key, so external monitoring at >1 RPS triggered a 17.77% 503 rate at 10 VUs.',
    resolution: 'Module-scoped write throttle (max 1 KV write/minute/isolate) with read on every probe. Post-fix error rate is 0%.',
  },
];

function sigTone(s: Run['significance']): {
  icon: typeof CheckCircle2;
  pill: string;
  badge: 'success' | 'info' | 'warning';
  dot: string;
  iconClass: string;
} {
  if (s === 'pass') return {
    icon: CheckCircle2,
    pill: 'Pass',
    badge: 'success',
    dot: 'var(--rag-healthy)',
    iconClass: 'text-accent',
  };
  if (s === 'note') return {
    icon: Activity,
    pill: 'Observed',
    badge: 'info',
    dot: 'var(--info)',
    iconClass: 't-muted',
  };
  return {
    icon: AlertTriangle,
    pill: 'Discovery',
    badge: 'warning',
    dot: 'var(--warning)',
    iconClass: 't-secondary',
  };
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

export default function PerformancePage(): JSX.Element {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-8">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
          <span className="t-muted text-caption">·</span>
          <Link to="/legal/security" className="t-muted hover:t-primary text-caption">Security &amp; Privacy</Link>
          <span className="t-muted text-caption">·</span>
          <Link to="/legal/connectors" className="t-muted hover:t-primary text-caption">Connectors</Link>
        </div>

        <PageHeader
          eyebrow="Platform · Performance"
          title="Performance"
          dek="Measured load-test results from the Atheon harness — real numbers, not aspirational SLO targets."
        />

        <Card variant="hero">
          <div className="flex items-start gap-4">
            <Activity className="text-accent flex-shrink-0 mt-1" size={22} />
            <div className="min-w-0">
              <p className="text-label mb-2" style={{ color: 'var(--accent)' }}>Measured · Not aspirational</p>
              <p className="text-body-sm t-secondary max-w-3xl">
                These are real numbers from the Atheon load-test harness
                (<code className="font-mono px-1.5 py-0.5 rounded-sm text-caption" style={{ background: 'var(--bg-secondary)' }}>scripts/load-test.mjs</code>)
                run against the production worker. We publish raw results, not curated marketing copy.
                For SLA negotiation, the methodology + tooling is open — your SRE team can reproduce these
                numbers from their own network, or scope a higher-VU test under a maintenance window.
              </p>
              <div className="flex items-center gap-3 mt-4 flex-wrap text-caption">
                <Link to="/status" className="text-accent hover:underline inline-flex items-center gap-1">
                  Live status <ExternalLink size={11} />
                </Link>
                <span className="t-muted">·</span>
                <a href="mailto:enterprise@vantax.co.za" className="text-accent hover:underline inline-flex items-center gap-1">
                  Scope a custom load test <ExternalLink size={11} />
                </a>
              </div>
            </div>
          </div>
        </Card>

        {/* Run cards — latency & throughput, mockup metric treatment */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-label">Latest Results</p>
            <span className="text-caption t-muted font-mono">
              Captured 2026-05-15 · production atheon-api.vantax.co.za
            </span>
          </div>
          <div className="space-y-4">
            {RUNS.map((run, i) => {
              const tone = sigTone(run.significance);
              const Icon = tone.icon;
              return (
                <Card key={i} variant="prominent">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          aria-hidden
                          className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: tone.dot }}
                        />
                        <h4 className="text-headline-sm t-primary">{run.label}</h4>
                        <Icon size={13} className={`${tone.iconClass} flex-shrink-0`} aria-hidden />
                        <Badge variant={tone.badge} size="sm">{tone.pill}</Badge>
                      </div>
                      <code className="font-mono text-caption t-muted block">{run.endpoint}</code>
                    </div>
                  </div>

                  {/* Hero latency metrics — P50 / P95 / P99 */}
                  <div
                    className="grid grid-cols-3 gap-4 py-4 px-1 mb-4 border-y"
                    style={{ borderColor: 'var(--border-card)' }}
                  >
                    {([
                      { label: 'P50', sub: 'Median', v: run.p50Ms },
                      { label: 'P95', sub: '95th pct', v: run.p95Ms },
                      { label: 'P99', sub: '99th pct', v: run.p99Ms },
                    ] as const).map((m) => (
                      <div key={m.label}>
                        <div className="text-label" style={{ color: 'var(--accent)' }}>{m.label}</div>
                        <div className="font-mono tabular-nums t-primary text-headline-xl mt-1">{fmtMs(m.v)}</div>
                        <div className="text-caption t-muted uppercase tracking-wider mt-0.5">{m.sub}</div>
                      </div>
                    ))}
                  </div>

                  <p className="text-body-sm t-secondary mb-4">{run.description}</p>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-y-3 gap-x-4">
                    <div>
                      <div className="text-label">VUs × Duration</div>
                      <div className="t-primary tabular-nums font-mono text-body-sm mt-0.5">{run.vus} × {run.durationSec}s</div>
                    </div>
                    <div>
                      <div className="text-label">Requests</div>
                      <div className="t-primary tabular-nums font-mono text-body-sm mt-0.5">{run.requestsTotal.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-label">Throughput</div>
                      <div className="t-primary tabular-nums font-mono text-body-sm mt-0.5">{run.throughputRps} req/s</div>
                    </div>
                    <div>
                      <div className="text-label">Operational Errors</div>
                      <div className={`tabular-nums font-mono text-body-sm mt-0.5 ${run.errorRatePct === 0 ? 'text-accent' : 'text-neg'}`}>{run.errorRatePct}%</div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Regression disclosure — honesty first */}
        <section>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <p className="text-label">Caught + Fixed · This Load-Test Pass</p>
            <span className="text-caption t-muted">Engineering hygiene · not curated numbers</span>
          </div>
          <div className="space-y-3">
            {REGRESSIONS.map((r, i) => (
              <Card key={i}>
                <div className="flex items-start gap-3">
                  <GitCommit size={16} className="t-secondary mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <Badge variant="warning" size="sm">Discovered {r.discovered}</Badge>
                      <span className="font-mono text-caption t-muted">Fixed in {r.fix}</span>
                    </div>
                    <p className="text-body-sm t-secondary mb-2">{r.summary}</p>
                    <p className="text-body-sm t-primary"><strong className="t-primary">Resolution:</strong> <span className="t-secondary">{r.resolution}</span></p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Methodology */}
        <section>
          <p className="text-label mb-3">Methodology</p>
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 text-body-sm">
              <div>
                <div className="text-label mb-1.5">Harness</div>
                <p className="t-secondary">Node 20, zero dependencies (just <code className="font-mono">fetch</code> + <code className="font-mono">performance.now()</code>). Source at <code className="font-mono">scripts/load-test.mjs</code> in the Atheon repo.</p>
              </div>
              <div>
                <div className="text-label mb-1.5">Profile</div>
                <p className="t-secondary">Conservative — 5–10 virtual users, 30-second windows, ≤5000 request cap, 5-second per-request timeout. Designed for routine performance verification; full stress testing scheduled under maintenance windows.</p>
              </div>
              <div>
                <div className="text-label mb-1.5">Network</div>
                <p className="t-secondary">Probe from operator workstation in af-south-1 (JNB), so latency includes user-edge RTT to the closest Cloudflare PoP. Direct edge-to-edge measurement is typically 30–60% lower.</p>
              </div>
              <div>
                <div className="text-label mb-1.5">Operational error</div>
                <p className="t-secondary">A response is an operational error only when the server failed to handle the request correctly (5xx, timeout, abort). A 401 from an unauthenticated SCIM probe is the correct response and counts as a pass.</p>
              </div>
            </div>
          </Card>
        </section>

        {/* Stated SLO */}
        <section>
          <p className="text-label mb-3">Stated Targets</p>
          <Card>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5 text-body-sm">
              <div>
                <div className="text-label mb-1.5">Uptime SLO</div>
                <div className="t-primary font-mono tabular-nums text-headline-sm">99.9% monthly</div>
                <p className="text-caption t-muted mt-1.5">~43 min / month allowance. Measured via /healthz.</p>
              </div>
              <div>
                <div className="text-label mb-1.5">API p95 target</div>
                <div className="t-primary font-mono tabular-nums text-headline-sm">≤ 500 ms cached · ≤ 2 s cold</div>
                <p className="text-caption t-muted mt-1.5">Per-tenant queries; reset on D1 region failover.</p>
              </div>
              <div>
                <div className="text-label mb-1.5">Incident response</div>
                <div className="t-primary font-mono tabular-nums text-headline-sm">15 min banner · 24 h customer notice · 5 day RCA</div>
                <p className="text-caption t-muted mt-1.5">Disclosed in detail at <Link to="/legal/security" className="text-accent hover:underline">/legal/security</Link>.</p>
              </div>
            </div>
          </Card>
        </section>

        <div className="text-caption t-muted text-center pt-2">
          Updated at the end of each release that ships meaningful performance changes.
          For binding SLA terms, see the Master Service Agreement provided at engagement.
        </div>
      </div>
    </div>
  );
}
