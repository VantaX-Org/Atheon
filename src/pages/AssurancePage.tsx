/**
 * Assurance — the auditor / compliance landing (v2 §7).
 *
 * Consolidates the three read-only evidence surfaces (evidence pack + audit
 * log, audit trail, data-governance records) behind ONE gated route so the
 * external auditor lands here and never sees anything else. This is the v2
 * §10 step-2.5 scoped landing that must exist BEFORE /compliance 301s here,
 * or the auditor role redirect-loops mid-engagement.
 *
 * Honesty: nothing new is fetched or computed here — each section mounts the
 * existing, proven surface component with its own real data path. This is a
 * consolidation shell, not a rewrite. Reversible: delete the route, the three
 * originals still stand.
 */
import { useState } from 'react';
import { ShieldCheck, ScrollText, Database, Gauge } from 'lucide-react';
import { ComplianceEvidence } from '@/pages/CompliancePage';
import { AuditPage } from '@/pages/AuditPage';
import { DataGovernancePage } from '@/pages/DataGovernancePage';
import { TrustPerformancePage } from '@/pages/TrustPerformancePage';
import { useAppStore } from '@/stores/appStore';

const SECTIONS = [
  { key: 'evidence', label: 'Evidence pack', icon: ShieldCheck, render: () => <ComplianceEvidence /> },
  { key: 'trail', label: 'Audit log', icon: ScrollText, render: () => <AuditPage /> },
  { key: 'governance', label: 'Governance', icon: Database, render: () => <DataGovernancePage /> },
  { key: 'trust', label: 'Trust & performance', icon: Gauge, render: () => <TrustPerformancePage /> },
] as const;

export function AssurancePage() {
  const [active, setActive] = useState<(typeof SECTIONS)[number]['key']>('evidence');
  // Governance API is admin+ (workers/api/src/routes/governance.ts) — hide the
  // tab from auditors rather than render a guaranteed 403.
  const isAuditor = useAppStore((s) => s.user?.role) === 'auditor';
  const sections = SECTIONS.filter((s) => !(isAuditor && s.key === 'governance'));
  const current = sections.find((s) => s.key === active) ?? sections[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="pb-1">
        <p className="text-sm t-secondary">Read-only evidence, audit trail, and governance records.</p>
      </header>

      {/* Section switcher — one surface at a time; each owns its data. */}
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border-card)] -mb-px" role="tablist" aria-label="Assurance sections">
        {sections.map((s) => {
          const on = s.key === active;
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              role="tab"
              aria-selected={on}
              onClick={() => setActive(s.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium border-b-2 transition-colors ${
                on ? 'border-accent t-primary' : 'border-transparent t-muted hover:t-secondary'
              }`}
            >
              <Icon size={14} />
              {s.label}
            </button>
          );
        })}
      </nav>

      <section role="tabpanel">{current.render()}</section>
    </div>
  );
}

export default AssurancePage;
