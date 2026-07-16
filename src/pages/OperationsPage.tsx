/**
 * Operations — the "run the machine" surface (v2 §6), now also the journey
 * CONNECT stage ("is my data flowing?").
 *
 * Three role-aware sections behind one URL, one nav item — same consolidation
 * shell as AssurancePage (nothing new is fetched here; each section mounts its
 * existing, proven surface with its own real data path, reversible):
 *   - Overview  (DataPage)            — everyone: KPIs + source list + re-sync
 *                                       (admin) + the hand-off to Findings.
 *   - Integration health              — manager+: read-only health, powered by
 *                                       the backend erp read re-cut.
 *   - Connections                     — admin only: connection tests + circuit
 *                                       breakers (erp mutations stay admin).
 *
 * Gate is STANDARD_ROLES so the CONNECT funnel keeps its lower roles; the
 * admin/manager tabs narrow further client-side. The backend counterpart —
 * loosening the two read-only erp GETs (connections, connections/health) to
 * managers while every erp mutation stays admin — lives in workers/api
 * (erpRolesFor).
 */
import { useState } from 'react';
import { Cable, PlugZap, Database } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ValueChainFlow } from '@/components/journey/ValueChainFlow';
import DataPage from '@/pages/DataPage';
import { ConnectivityPage } from '@/pages/ConnectivityPage';
import { IntegrationHealthPage } from '@/pages/IntegrationHealthPage';

type Visibility = 'all' | 'manager' | 'admin';

const SECTIONS = [
  { key: 'overview', label: 'Overview', icon: Database, see: 'all' as Visibility, render: () => <DataPage /> },
  { key: 'health', label: 'Integration health', icon: PlugZap, see: 'manager' as Visibility, render: () => <IntegrationHealthPage /> },
  { key: 'connections', label: 'Connections', icon: Cable, see: 'admin' as Visibility, render: () => <ConnectivityPage /> },
] as const;

export function OperationsPage() {
  const role = useAppStore((s) => s.user?.role);
  const isAdmin = role === 'superadmin' || role === 'support_admin' || role === 'admin';
  const isManagerPlus = isAdmin || role === 'executive' || role === 'manager';
  const canSee = (v: Visibility) => v === 'all' || (v === 'manager' && isManagerPlus) || (v === 'admin' && isAdmin);

  const visible = SECTIONS.filter((s) => canSee(s.see));
  const [active, setActive] = useState<string>('overview');
  const current = visible.find((s) => s.key === active) ?? visible[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-1">
        <p className="text-sm font-semibold t-primary">Data &amp; Sources</p>
        <p className="text-sm t-secondary">Is your data flowing — and, for admins, every source connected or broken and how each integration runs.</p>
      </header>

      <ValueChainFlow focus="connect" />

      {/* Section switcher — one view at a time; each owns its data. Tabs narrow by role. */}
      {visible.length > 1 && (
        <nav className="flex flex-wrap gap-1 border-b border-[var(--border-card)] -mb-px" role="tablist" aria-label="Data and sources">
          {visible.map((s) => {
            const on = s.key === current.key;
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
      )}

      <section role="tabpanel">{current.render()}</section>
    </div>
  );
}

export default OperationsPage;
