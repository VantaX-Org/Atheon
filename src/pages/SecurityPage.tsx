/**
 * /legal/security — public security overview + sub-processor list + DPA.
 *
 * Phase BA procurement gate: every 3000+ headcount enterprise's security
 * questionnaire (CAIQ, SIG-Lite, etc.) has these checkboxes — sub-processor
 * disclosure, DPA availability, encryption posture, data-residency map.
 * Surfacing this PUBLICLY shortens the procurement cycle materially because
 * the vendor-risk team can answer 60% of their checklist without a meeting.
 *
 * What's on this page:
 *   1. Security overview — high-level posture (encryption, MFA, RBAC, etc.)
 *   2. Sub-processor list — every third party that touches customer data
 *   3. Data residency map — where physically data is stored at rest
 *   4. Compliance frameworks claimed + evidence-pack pointer
 *   5. DPA / DPIA contact — how to get the legal docs for signing
 *   6. Incident disclosure SLA — when affected customers will be notified
 *
 * Public — no auth, no role gating. Intentionally crawler-friendly so a
 * procurement team can search-engine for it.
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import {
  Shield, Lock, KeyRound, MapPin, FileText, Mail, Activity,
  CheckCircle2, ArrowLeft, ExternalLink,
} from 'lucide-react';

const SUBPROCESSORS = [
  { name: 'Cloudflare, Inc.', purpose: 'Compute (Workers), durable storage (D1, R2, KV), edge networking', region: 'Global edge + af-south-1 (JNB) origin', dpUrl: 'https://www.cloudflare.com/cloudflare-customer-dpa/' },
  { name: 'Anthropic PBC', purpose: 'LLM inference for Mind / chat / catalyst reasoning (configurable, can be disabled per tenant)', region: 'US-East', dpUrl: 'https://www.anthropic.com/legal/dpa' },
  { name: 'Microsoft Corporation', purpose: 'Optional Azure AD SSO + Microsoft Graph email (only if tenant enables)', region: 'EU / customer-selected', dpUrl: 'https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA' },
  { name: 'WorkOS, Inc.', purpose: 'SAML federation broker for enterprise SSO (only if tenant enables)', region: 'US', dpUrl: 'https://workos.com/legal/dpa' },
  { name: 'Stripe, Inc.', purpose: 'Payments processing (subscription billing only — no payment data persisted by Atheon)', region: 'Global', dpUrl: 'https://stripe.com/legal/dpa' },
];

const POSTURE = [
  { icon: Lock, title: 'Encryption in transit', detail: 'TLS 1.2+ on every endpoint. HSTS enforced. Inter-service traffic in private Cloudflare backbone.' },
  { icon: Lock, title: 'Encryption at rest', detail: 'D1 storage encrypted by Cloudflare. R2 objects encrypted server-side. Customer-managed keys (BYOK) are on the roadmap, not yet available.' },
  { icon: KeyRound, title: 'Identity', detail: 'SAML 2.0 (via WorkOS) + OIDC (Azure AD). SCIM 2.0 provisioning. MFA enforced for admin roles with grace-period tracking.' },
  { icon: Shield, title: 'Access control', detail: '10 built-in roles incl. scoped auditor + board_member. Custom roles. Tenant isolation enforced at the query layer; every D1 query is tenant-id-bound.' },
  { icon: FileText, title: 'Audit trail', detail: 'Cryptographically-chained provenance ledger (SHA-256 root hash, hourly anchor). Append-only audit_log. Verifiable via /api/audit/provenance/verify.' },
  { icon: Activity, title: 'Monitoring', detail: 'Public /status page with 30-second polling. Hourly D1 snapshots, 30-day retention. RTO ≤ 4h, RPO ≤ 1h.' },
];

// Honesty: Atheon holds no third-party audit certification today, so no row
// may say "Certified". Pills state the actual posture per framework.
const FRAMEWORKS: Array<{ name: string; status: string; pill: string; tone: 'success' | 'warning' }> = [
  { name: 'SOC 2 Type II', status: 'Controls implemented (self-assessed, not yet independently audited) · evidence pack live on /compliance for Auditor role', pill: 'Controls implemented', tone: 'warning' },
  { name: 'POPIA (South Africa)', status: 'DSAR endpoints live · 30-day response SLA', pill: 'Supported', tone: 'success' },
  { name: 'GDPR (EU)', status: 'DSAR + erasure endpoints · Art. 28 DPA available on request', pill: 'Supported', tone: 'success' },
  { name: 'ISO 27001', status: 'Gap assessment in progress — Q3 2026 target', pill: 'In progress', tone: 'warning' },
];

export default function SecurityPage(): JSX.Element {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
        </div>

        {/* Hero — editorial posture header */}
        <header className="space-y-5">
          <div className="text-label">Platform · Security</div>
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-display font-bold t-primary tracking-tight">Security Posture</h1>
              <p className="text-body t-secondary mt-2 max-w-2xl">
                Enterprise procurement summary — posture, sub-processors, compliance claims, and DPA contact.
              </p>
            </div>
            <span className="text-caption t-muted flex-shrink-0 font-mono uppercase tracking-wide">
              Datasheet · updated 15 Jul 2026
            </span>
          </div>

          <Card className="card-accent p-6">
            <div className="flex items-start gap-3">
              <Shield className="text-accent flex-shrink-0 mt-0.5" size={22} />
              <div>
                <h2 className="text-headline-md font-bold t-primary mb-2">Built for enterprise procurement</h2>
                <p className="text-body-sm t-secondary">
                  Atheon processes ERP-grade financial data, so security is the floor — not a feature.
                  This page is the public-facing summary of our posture, sub-processors, and compliance
                  claims. For the full evidence pack, a Data Processing Agreement, or a security
                  questionnaire response (CAIQ / SIG / vendor-specific), contact{' '}
                  <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a>.
                </p>
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  <Link to="/status" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                    Platform status <ExternalLink size={11} />
                  </Link>
                  <span className="t-muted text-caption">·</span>
                  <Link to="/legal/connectors" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                    Connector matrix <ExternalLink size={11} />
                  </Link>
                  <span className="t-muted text-caption">·</span>
                  <Link to="/legal/performance" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                    Performance <ExternalLink size={11} />
                  </Link>
                  <span className="t-muted text-caption">·</span>
                  <a href="mailto:dpa@vantax.co.za" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                    Request DPA template <Mail size={11} />
                  </a>
                </div>
              </div>
            </div>
          </Card>
        </header>

        {/* Security posture grid — RAG status cards, mono eyebrow labels */}
        <section>
          <div className="text-label mb-4">Security Posture</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {POSTURE.map((p) => {
              const Icon = p.icon;
              return (
                <Card key={p.title} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <span
                        className="flex-shrink-0 inline-flex items-center justify-center rounded-lg"
                        style={{ width: 34, height: 34, background: 'var(--accent-subtle)' }}
                      >
                        <Icon size={16} className="text-accent" />
                      </span>
                      <div className="min-w-0">
                        <h4 className="text-label" style={{ color: 'var(--text-secondary)' }}>{p.title}</h4>
                        <p className="text-caption t-secondary mt-1.5 leading-relaxed">{p.detail}</p>
                      </div>
                    </div>
                    <span className="pill pill-success flex-shrink-0" aria-label="Status healthy">
                      <CheckCircle2 size={12} /> Active
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Compliance frameworks */}
        <section>
          <div className="text-label mb-2">Compliance Posture</div>
          <p className="text-caption t-muted mb-4 max-w-2xl">
            Atheon does not currently hold a third-party audit certification. Statuses below are
            self-assessed; supporting evidence is available for review on request.
          </p>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                  <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>Framework</th>
                  <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {FRAMEWORKS.map((f) => (
                  <tr key={f.name} className="border-b border-[var(--border-card)] last:border-0">
                    <td className="px-5 py-4 t-primary font-medium align-top">
                      <span className="inline-flex items-center gap-2">
                        <span className={`pill ${f.tone === 'success' ? 'pill-success' : 'pill-warning'}`}>
                          {f.pill}
                        </span>
                        {f.name}
                      </span>
                    </td>
                    <td className="px-5 py-4 t-secondary align-top">{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        {/* Sub-processor list — required for GDPR Art. 28 + most enterprise procurement */}
        <section>
          <div className="text-label mb-2">Sub-processors</div>
          <p className="text-caption t-muted mb-4 max-w-2xl">
            Third parties that may process customer data. Optional sub-processors only apply when the
            relevant tenant feature is enabled. Material changes are disclosed 30 days in advance.
          </p>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-[var(--border-card)]" style={{ background: 'var(--bg-secondary)' }}>
                    <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>Sub-processor</th>
                    <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>Purpose</th>
                    <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>Region</th>
                    <th className="text-left px-5 py-3 text-label" style={{ color: 'var(--text-muted)' }}>DPA</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBPROCESSORS.map((s) => (
                    <tr key={s.name} className="border-b border-[var(--border-card)] last:border-0">
                      <td className="px-5 py-4 t-primary font-medium align-top">{s.name}</td>
                      <td className="px-5 py-4 t-secondary align-top">{s.purpose}</td>
                      <td className="px-5 py-4 t-muted align-top font-mono text-caption">{s.region}</td>
                      <td className="px-5 py-4 align-top">
                        <a href={s.dpUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-caption">
                          View <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* Data residency */}
        <section>
          <div className="text-label mb-4">Data Residency</div>
          <Card className="p-6">
            <div className="flex items-start gap-3 mb-5">
              <span
                className="flex-shrink-0 inline-flex items-center justify-center rounded-lg mt-0.5"
                style={{ width: 34, height: 34, background: 'var(--accent-subtle)' }}
              >
                <MapPin size={16} className="text-accent" />
              </span>
              <p className="text-body-sm t-secondary">
                Customer durable state (D1 database, R2 object storage) is pinned to{' '}
                <strong className="t-primary">af-south-1 (Johannesburg)</strong> by default.
                Cloudflare Workers compute runs at the closest global edge for the requesting user.
                Inference traffic to Anthropic (when enabled) routes via US-East.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-body-sm">
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-label mb-2">Primary region</div>
                <div className="t-primary font-medium font-mono text-body-sm">af-south-1 (Johannesburg)</div>
              </div>
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-label mb-2">Compute</div>
                <div className="t-primary font-medium">Cloudflare global edge</div>
              </div>
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-label mb-2">Backups</div>
                <div className="t-primary font-medium font-mono text-body-sm">Hourly · 30-day retention</div>
              </div>
            </div>
            <p className="text-caption t-muted mt-4">
              EU / US / APAC residency available on the Enterprise plan via dedicated D1 instances.
              Contact <a href="mailto:enterprise@vantax.co.za" className="text-accent hover:underline">enterprise@vantax.co.za</a> for regional placement.
            </p>
          </Card>
        </section>

        {/* Incident-disclosure SLA */}
        <section>
          <div className="text-label mb-4">Incident Disclosure</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-body-sm">
            {[
              { label: 'Confirmed breach', body: <>Notify affected customers within <strong>24 hours</strong></> },
              { label: 'Service outage', body: <>Public banner on <Link to="/status" className="text-accent hover:underline">/status</Link> within <strong>15 minutes</strong></> },
              { label: 'Post-incident review', body: <>RCA published within <strong>5 business days</strong></> },
            ].map((sla, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start gap-3">
                  <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--rag-healthy)' }} />
                  <div>
                    <div className="text-label mb-1.5">{sla.label}</div>
                    <div className="t-primary">{sla.body}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section>
          <div className="text-label mb-4">Contact</div>
          <Card className="p-6">
            <div className="space-y-2.5 text-body-sm">
              <div className="flex items-start gap-2"><Mail size={13} className="t-muted flex-shrink-0 mt-0.5" /> <span>Security questions / vendor-risk: <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a></span></div>
              <div className="flex items-start gap-2"><Mail size={13} className="t-muted flex-shrink-0 mt-0.5" /> <span>DPA / privacy: <a href="mailto:dpa@vantax.co.za" className="text-accent hover:underline">dpa@vantax.co.za</a></span></div>
              <div className="flex items-start gap-2"><Mail size={13} className="t-muted flex-shrink-0 mt-0.5" /> <span>Vulnerability disclosure: <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a> (responsible disclosure honoured; no bug-bounty programme yet)</span></div>
            </div>
          </Card>
        </section>

        <div className="text-caption t-muted text-center pt-2">
          This page is informational and does not constitute a contract. Material terms are in the
          Master Service Agreement and Data Processing Agreement provided at the start of each engagement.
        </div>
      </div>
    </div>
  );
}
