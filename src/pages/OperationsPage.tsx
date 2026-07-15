/**
 * Operations — the "run the machine" surface (v2 §6).
 *
 * First increment: the §6.3 **Sources** consolidation. The two admin
 * source-health pages (connection status + integration health) share one
 * PLATFORM_ADMIN gate and one job — "is each source connected, and is it
 * healthy" — so they fold behind a single section switcher, one URL, one
 * nav item. Same consolidation-shell pattern as AssurancePage: nothing new
 * is fetched here; each section mounts its existing, proven surface with its
 * own real data path. Reversible — delete the route, the originals still stand.
 *
 * Deferred (larger / backend-coupled, NOT in this increment):
 * - Queue + Playbooks (dismantling the 3303-line CatalystsPage) — regression
 *   risk on the billing/approval paths; /catalysts ("Fixes") stays the queue.
 * - Folding DataPage in + re-cutting connectivity/integration-health backend
 *   endpoints to MANAGER_ROLES (§6.3, IA F9) — a privilege-model change that
 *   needs the workers/api re-cut first, or managers just 403 the API.
 */
import { useState } from 'react';
import { Cable, PlugZap } from 'lucide-react';
import { ConnectivityPage } from '@/pages/ConnectivityPage';
import { IntegrationHealthPage } from '@/pages/IntegrationHealthPage';

const SECTIONS = [
  { key: 'connections', label: 'Connections', icon: Cable, render: () => <ConnectivityPage /> },
  { key: 'health', label: 'Integration health', icon: PlugZap, render: () => <IntegrationHealthPage /> },
] as const;

export function OperationsPage() {
  const [active, setActive] = useState<(typeof SECTIONS)[number]['key']>('connections');
  const current = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-1">
        <p className="text-sm font-semibold t-primary">Operations · Sources</p>
        <p className="text-sm t-secondary">Every source — connected or broken, and how each integration is running.</p>
      </header>

      {/* Section switcher — one source view at a time; each owns its data. */}
      <nav className="flex flex-wrap gap-1 border-b border-[var(--border-card)] -mb-px" role="tablist" aria-label="Operations sources">
        {SECTIONS.map((s) => {
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

export default OperationsPage;
