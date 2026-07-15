/**
 * /legal/connectors — public connector conformance matrix (Phase BB).
 *
 * Procurement-direct artifact: CIOs ask "do you support SAP S/4HANA?
 * Workday? Coupa?" — having one URL to send is a measurable cycle
 * shortener. This page lists every connector we ship, what level of
 * conformance it has reached, and a short rationale so a vendor-risk
 * team can pattern-match against their own roadmap honestly.
 *
 * Conformance levels (carried over from the internal phase-gate model):
 *   - GA    — production-grade, multiple live tenants, OAuth2/token
 *             refresh tested, write-back error paths exercised
 *   - Beta  — real REST/SOAP integration implemented; awaiting a live
 *             customer tenant for full conformance certification
 *   - Preview — stub-only or read-only today; production write-back
 *             ships as a fast-follow once the integration is engaged
 *   - On request — not yet built; engineering scoped at engagement
 *
 * Honesty first: nothing on this page is overclaimed. Procurement
 * notices and remembers when a vendor says "supported" and means
 * "we have a stub file."
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import {
  Plug, ArrowLeft, Mail, ExternalLink, CheckCircle2, Circle,
} from 'lucide-react';

const MONO = "'Space Mono', ui-monospace, monospace";

type ConformanceLevel = 'GA' | 'Beta' | 'Preview' | 'On request';

interface Connector {
  vendor: string;
  product: string;
  category: 'ERP' | 'HCM' | 'CRM' | 'Accounting' | 'Procurement' | 'Custom';
  protocol: string;
  read: boolean;
  writeBack: boolean;
  level: ConformanceLevel;
  notes: string;
}

const CONNECTORS: Connector[] = [
  // Enterprise ERPs
  { vendor: 'SAP', product: 'S/4HANA (Cloud + On-prem)', category: 'ERP', protocol: 'OData v4 + CSRF', read: true, writeBack: true, level: 'Beta', notes: 'OAuth2 + CSRF token-fetch implemented. AR / AP / GL write-back live.' },
  { vendor: 'Oracle', product: 'Fusion Cloud ERP', category: 'ERP', protocol: 'REST + Basic Auth', read: true, writeBack: true, level: 'Beta', notes: 'Journal, AR, AP write-back via Fusion REST. Multi-org supported.' },
  { vendor: 'Microsoft', product: 'Dynamics 365 Finance', category: 'ERP', protocol: 'OData v4 + Azure AD', read: true, writeBack: true, level: 'Beta', notes: 'Azure AD OAuth2; standard D365 entity model.' },
  { vendor: 'Oracle', product: 'NetSuite (SuiteTalk REST)', category: 'ERP', protocol: 'REST + TBA', read: true, writeBack: true, level: 'Beta', notes: 'Token-Based Authentication; transactions + saved searches.' },
  { vendor: 'Workday', product: 'Financial Management', category: 'HCM', protocol: 'REST + OAuth2 ISU', read: true, writeBack: true, level: 'Beta', notes: 'HCM-first; financial actions limited to journal post, AP, customer credit.' },
  { vendor: 'Sage', product: 'Intacct (XML + REST)', category: 'Accounting', protocol: 'REST + Session Key', read: true, writeBack: true, level: 'Beta', notes: 'Session-key auth + Intacct API v3.' },
  { vendor: 'Sage', product: 'X3 / 200 Evolution', category: 'ERP', protocol: 'REST + API Key', read: true, writeBack: true, level: 'Beta', notes: 'Sage X3 entities + Sage Evolution feed.' },
  { vendor: 'Odoo', product: '15 / 16 / 17 Community + Enterprise', category: 'ERP', protocol: 'JSON-RPC', read: true, writeBack: true, level: 'Beta', notes: 'Native JSON-RPC; account.move + account.payment models.' },

  // GA SMB stack — most tested
  { vendor: 'Xero', product: 'Accounting', category: 'Accounting', protocol: 'OAuth2 + REST', read: true, writeBack: true, level: 'GA', notes: 'Live across multiple tenants. Invoices, bills, payments, contacts.' },
  { vendor: 'Intuit', product: 'QuickBooks Online', category: 'Accounting', protocol: 'OAuth2 + REST', read: true, writeBack: true, level: 'GA', notes: 'Live across multiple tenants. AR/AP + journal entries.' },

  // CRM (CRM-side ERP signal; not full ERP)
  { vendor: 'Salesforce', product: 'Sales Cloud / Service Cloud', category: 'CRM', protocol: 'REST + SOQL', read: true, writeBack: true, level: 'Beta', notes: 'Used as CRM-side signal source; full revenue-recognition write-back is on roadmap.' },

  // Preview / stub
  { vendor: 'Sage', product: '50cloud / Pastel', category: 'Accounting', protocol: 'CSV + SOAP', read: true, writeBack: false, level: 'Preview', notes: 'Read-only via export pipeline today; write-back via API on request.' },

  // Custom path
  { vendor: 'Atheon', product: 'Generic Webhook + CSV', category: 'Custom', protocol: 'Webhook / CSV / SFTP', read: true, writeBack: false, level: 'Preview', notes: 'Catch-all for legacy systems without modern APIs.' },

  // Procurement (commonly asked, honest "not yet")
  { vendor: 'Coupa', product: 'Spend Management', category: 'Procurement', protocol: 'REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement — typical 4–6 weeks to GA.' },
  { vendor: 'SAP', product: 'Ariba Procurement', category: 'Procurement', protocol: 'cXML + REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement — typical 6–10 weeks given cXML envelope work.' },
  { vendor: 'Jaggaer', product: 'Sourcing & Procurement', category: 'Procurement', protocol: 'REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement.' },
];

// Conformance level → status-pill tones. Brand accent = GA (live/primary);
// RAG amber = Preview (watch); muted = not-yet-built. Beta uses the info voice.
const LEVEL_TONE: Record<ConformanceLevel, { bg: string; border: string; textStyle: React.CSSProperties }> = {
  GA:           { bg: 'var(--accent-subtle)',                     border: 'rgb(var(--accent-rgb) / 0.32)',     textStyle: { color: 'var(--accent)' } },
  Beta:         { bg: 'rgba(108, 122, 142, 0.10)',               border: 'rgba(108, 122, 142, 0.28)',         textStyle: { color: 'var(--info)' } },
  Preview:      { bg: 'rgb(var(--rag-watch-rgb) / 0.12)',         border: 'rgb(var(--rag-watch-rgb) / 0.30)',  textStyle: { color: 'var(--rag-watch)' } },
  'On request': { bg: 'rgba(160, 160, 180, 0.10)',               border: 'rgba(160, 160, 180, 0.30)',         textStyle: {} },
};

function LevelBadge({ level }: { level: ConformanceLevel }) {
  const tone = LEVEL_TONE[level];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold${level === 'On request' ? ' t-muted' : ''}`}
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, fontFamily: MONO, ...tone.textStyle }}
    >
      {level}
    </span>
  );
}

export default function ConnectorsPage(): JSX.Element {
  const counts = CONNECTORS.reduce<Record<ConformanceLevel, number>>((acc, c) => {
    acc[c.level] = (acc[c.level] ?? 0) + 1;
    return acc;
  }, { GA: 0, Beta: 0, Preview: 0, 'On request': 0 });

  const total = CONNECTORS.length;
  // "Live" = GA + Beta connectors carry a real implemented integration.
  const live = counts.GA + counts.Beta;
  // "Attention" = stub/read-only Preview + not-yet-built On request.
  const attention = counts.Preview + counts['On request'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 md:p-8 max-w-7xl mx-auto space-y-8">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
          <span className="t-muted text-caption">·</span>
          <Link to="/legal/security" className="t-muted hover:t-primary text-caption">Security &amp; Privacy</Link>
        </div>

        <PageHeader
          eyebrow="Connectors · Catalog"
          title="Integration Catalog"
          dek="Honest conformance levels for every ERP / HCM / Accounting / CRM / Procurement connector Atheon ships."
        />

        {/* Summary stat cards — real catalog inventory, no fabricated metrics. */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <Card className="p-6">
            <p className="text-[11px] uppercase tracking-[0.14em] t-muted font-medium" style={{ fontFamily: MONO }}>Total Connectors</p>
            <p className="mt-3 text-5xl t-primary leading-none tabular-nums font-bold" style={{ fontFamily: MONO }}>{total}</p>
            <p className="mt-3 text-caption uppercase tracking-wider t-muted" style={{ fontFamily: MONO }}>Catalogued Sources</p>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] t-muted font-medium" style={{ fontFamily: MONO }}>Live Integrations</p>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold" style={{ fontFamily: MONO, background: 'var(--accent-subtle)', border: '1px solid rgb(var(--accent-rgb) / 0.32)', color: 'var(--accent)' }}>GA + Beta</span>
            </div>
            <p className="mt-3 text-5xl t-primary leading-none tabular-nums font-bold" style={{ fontFamily: MONO }}>{live}</p>
            <p className="mt-3 text-caption uppercase tracking-wider t-muted" style={{ fontFamily: MONO }}>Implemented Adapters</p>
          </Card>
          <Card className="p-6">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] uppercase tracking-[0.14em] t-muted font-medium" style={{ fontFamily: MONO }}>Attention Needed</p>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] uppercase tracking-wider font-semibold" style={{ fontFamily: MONO, background: 'rgb(var(--rag-watch-rgb) / 0.12)', border: '1px solid rgb(var(--rag-watch-rgb) / 0.30)', color: 'var(--rag-watch)' }}>Preview + Req</span>
            </div>
            <p className="mt-3 text-5xl t-primary leading-none tabular-nums font-bold" style={{ fontFamily: MONO }}>{attention}</p>
            <p className="mt-3 text-caption uppercase tracking-wider t-muted" style={{ fontFamily: MONO }}>Stub / Not Yet Built</p>
          </Card>
        </div>

        {/* Connector card grid — replaces the dense matrix table with the
            editorial card treatment from the catalog mockup. */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {CONNECTORS.map((c, i) => (
            <Card key={i} className="p-6 flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span
                    className="flex-shrink-0 w-10 h-10 rounded-xl inline-flex items-center justify-center"
                    style={{ background: 'var(--accent-subtle)', border: '1px solid rgb(var(--accent-rgb) / 0.18)' }}
                    aria-hidden
                  >
                    <Plug size={18} style={{ color: 'var(--accent)' }} />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-headline-sm t-primary font-semibold uppercase tracking-wide truncate" style={{ fontFamily: MONO }}>{c.vendor}</h3>
                    <p className="text-body-sm t-secondary truncate">{c.product}</p>
                  </div>
                </div>
                <LevelBadge level={c.level} />
              </div>

              <div className="mt-5 flex items-center gap-2 flex-wrap">
                <Badge variant="default" size="sm">{c.category}</Badge>
                <span className="text-caption t-secondary" style={{ fontFamily: MONO }}>{c.protocol}</span>
              </div>

              <div className="mt-4 flex items-center gap-5 text-caption">
                <span className="inline-flex items-center gap-1.5 t-secondary">
                  {c.read
                    ? <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />
                    : <Circle size={14} className="t-muted opacity-30" />}
                  <span className="uppercase tracking-wider" style={{ fontFamily: MONO }}>Read</span>
                </span>
                <span className="inline-flex items-center gap-1.5 t-secondary">
                  {c.writeBack
                    ? <CheckCircle2 size={14} style={{ color: 'var(--accent)' }} />
                    : <Circle size={14} className="t-muted opacity-30" />}
                  <span className="uppercase tracking-wider" style={{ fontFamily: MONO }}>Write-back</span>
                </span>
              </div>

              <p className="mt-4 text-body-sm t-secondary leading-relaxed flex-1">{c.notes}</p>
            </Card>
          ))}
        </div>

        {/* Conformance-level legend */}
        <Card className="p-5">
          <h3 className="text-caption uppercase tracking-wider t-muted font-medium mb-3" style={{ fontFamily: MONO }}>Conformance levels</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-body-sm">
            <div className="flex items-start gap-2">
              <LevelBadge level="GA" />
              <span className="t-secondary">Production-grade, multiple live tenants, OAuth2/token refresh tested, write-back error paths exercised.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="Beta" />
              <span className="t-secondary">Real REST/SOAP integration implemented; awaiting a live customer tenant for full certification.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="Preview" />
              <span className="t-secondary">Stub-only or read-only today; production write-back ships as a fast-follow.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="On request" />
              <span className="t-secondary">Not yet built; engineering scoped at engagement with a typical timeline noted in the row.</span>
            </div>
          </div>
        </Card>

        {/* Engagement path */}
        <Card className="p-6">
          <h3 className="text-headline-sm font-semibold t-primary mb-2">Not on the list?</h3>
          <p className="text-body-sm t-secondary mb-4 max-w-3xl">
            New connectors go through a standard build-out:{' '}
            <strong className="t-primary">discover</strong> (2–3 days API-doc review) →{' '}
            <strong className="t-primary">read-side adapter</strong> (1 week) →{' '}
            <strong className="t-primary">write-back adapter</strong> (1–2 weeks) →{' '}
            <strong className="t-primary">live-tenant certification</strong> (1 week). The
            shared-savings model means you only pay once a connector starts recovering Rand —
            engineering risk sits with us, not you.
          </p>
          <div className="flex items-center gap-3 flex-wrap text-body-sm">
            <a
              href="mailto:partnerships@vantax.co.za"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full font-medium text-[var(--accent-contrast,#fff)]"
              style={{ background: 'var(--accent)' }}
            >
              <Mail size={14} /> Scope a new connector
            </a>
            <a href="https://atheon-api.vantax.co.za/api/v1/openapi.json" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              OpenAPI spec <ExternalLink size={12} />
            </a>
          </div>
        </Card>

        <div className="text-caption t-muted text-center pt-2">
          Catalog last reviewed 15 July 2026. Updated alongside the Atheon platform release notes. Material additions are documented
          in the changelog and announced 30 days before any deprecation.
        </div>
      </div>
    </div>
  );
}
