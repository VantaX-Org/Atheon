/**
 * Console — the platform-administration quarantine (v2 §10 step 5).
 *
 * Every admin-world surface (tenancy, access, platform ops, integrations,
 * support, governance) lived as ~20 separate routes scattered across the
 * journey Sidebar's ADMIN disclosure. That leaked platform-operator tooling
 * into the same rail an operator/exec walks their value loop on. This folds
 * them behind ONE entry with its own grouped left-nav — the operator/exec
 * journey rail no longer carries any of it.
 *
 * Same reversible mount-shell as OperationsPage / AssurancePage: nothing new
 * is fetched here. Each section lazy-mounts its existing, proven page with its
 * own real data path — no route is deleted, so drill-downs (webhook detail,
 * tenant LLM budget) and old deep-links still resolve standalone. Sections
 * narrow by role client-side; the route floor is PLATFORM_ADMIN_ROLES and each
 * section carries its own floor ('admin' | 'support' | 'super') matching the
 * per-route gates it replaced.
 *
 * Deep-linkable via ?section=<key> so ⌘K / GlobalSearch can jump straight in.
 */
import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MiniRiver } from '@/x/MiniRiver';
import { consoleNavRiver } from '@/x/flows';
import {
  Loader2,
  Building2, Building, CreditCard,
  KeyRound, UserCog, UserPlus,
  Cpu, HeartPulse, Bell, Rocket, ClipboardList, Flag,
  Network, Webhook, Inbox,
  Headset, ListFilter, UserSearch, AlertTriangle,
  BadgeCheck,
  type LucideIcon,
} from 'lucide-react';
import { lazyWithRetry } from '@/lib/lazy-with-retry';
import { useAppStore } from '@/stores/appStore';

// Lazy per-section so only the open surface loads — the Console chunk stays
// small and each admin page keeps its own code-split boundary.
const TenantsPage = lazyWithRetry(() => import('@/pages/TenantsPage').then(m => ({ default: m.TenantsPage })));
const TenantManagementPage = lazyWithRetry(() => import('@/pages/TenantManagementPage').then(m => ({ default: m.TenantManagementPage })));
const RevenueUsagePage = lazyWithRetry(() => import('@/pages/RevenueUsagePage').then(m => ({ default: m.RevenueUsagePage })));
const IAMPage = lazyWithRetry(() => import('@/pages/IAMPage').then(m => ({ default: m.IAMPage })));
const CustomRoleBuilderPage = lazyWithRetry(() => import('@/pages/CustomRoleBuilderPage').then(m => ({ default: m.CustomRoleBuilderPage })));
const BulkUserManagementPage = lazyWithRetry(() => import('@/pages/BulkUserManagementPage').then(m => ({ default: m.BulkUserManagementPage })));
const ControlPlanePage = lazyWithRetry(() => import('@/pages/ControlPlanePage').then(m => ({ default: m.ControlPlanePage })));
const PlatformHealthPage = lazyWithRetry(() => import('@/pages/PlatformHealthPage').then(m => ({ default: m.PlatformHealthPage })));
const SystemAlertsPage = lazyWithRetry(() => import('@/pages/SystemAlertsPage').then(m => ({ default: m.SystemAlertsPage })));
const DeploymentsPage = lazyWithRetry(() => import('@/pages/DeploymentsPage').then(m => ({ default: m.DeploymentsPage })));
const AssessmentsPage = lazyWithRetry(() => import('@/pages/AssessmentsPage').then(m => ({ default: m.AssessmentsPage })));
const FeatureFlagsPage = lazyWithRetry(() => import('@/pages/FeatureFlagsPage').then(m => ({ default: m.FeatureFlagsPage })));
const IntegrationsPage = lazyWithRetry(() => import('@/pages/IntegrationsPage').then(m => ({ default: m.IntegrationsPage })));
const WebhooksPage = lazyWithRetry(() => import('@/pages/WebhooksPage').then(m => ({ default: m.WebhooksPage })));
const ActionLayerPage = lazyWithRetry(() => import('@/pages/ActionLayerPage').then(m => ({ default: m.ActionLayerPage })));
const SupportConsolePage = lazyWithRetry(() => import('@/pages/SupportConsolePage').then(m => ({ default: m.SupportConsolePage })));
const SupportTriagePage = lazyWithRetry(() => import('@/pages/admin/SupportTriagePage').then(m => ({ default: m.SupportTriagePage })));
const ImpersonationPage = lazyWithRetry(() => import('@/pages/ImpersonationPage').then(m => ({ default: m.ImpersonationPage })));
const StatusIncidentsAdminPage = lazyWithRetry(() => import('@/pages/admin/StatusIncidentsAdminPage'));
const CompliancePage = lazyWithRetry(() => import('@/pages/CompliancePage'));

type Floor = 'admin' | 'support' | 'super';

interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
  floor: Floor;
  render: () => JSX.Element;
}

interface Group {
  label: string;
  sections: Section[];
}

// Groups mirror the admin jobs-to-be-done; each section's floor matches the
// per-route gate it replaced (see src/App.tsx admin routes).
const GROUPS: Group[] = [
  {
    label: 'Tenancy',
    sections: [
      { key: 'clients', label: 'Clients', icon: Building2, floor: 'super', render: () => <TenantsPage /> },
      { key: 'tenant-admin', label: 'Tenant admin', icon: Building, floor: 'super', render: () => <TenantManagementPage /> },
      { key: 'revenue', label: 'Revenue', icon: CreditCard, floor: 'super', render: () => <RevenueUsagePage /> },
    ],
  },
  {
    label: 'Access',
    sections: [
      { key: 'iam', label: 'IAM', icon: KeyRound, floor: 'admin', render: () => <IAMPage /> },
      { key: 'custom-roles', label: 'Custom roles', icon: UserCog, floor: 'admin', render: () => <CustomRoleBuilderPage /> },
      { key: 'bulk-users', label: 'Bulk users', icon: UserPlus, floor: 'admin', render: () => <BulkUserManagementPage /> },
    ],
  },
  {
    label: 'Platform',
    sections: [
      { key: 'control-plane', label: 'Control plane', icon: Cpu, floor: 'admin', render: () => <ControlPlanePage /> },
      { key: 'health', label: 'Operations health', icon: HeartPulse, floor: 'admin', render: () => <PlatformHealthPage /> },
      { key: 'alerts', label: 'System alerts', icon: Bell, floor: 'admin', render: () => <SystemAlertsPage /> },
      { key: 'deployments', label: 'Deployments', icon: Rocket, floor: 'super', render: () => <DeploymentsPage /> },
      { key: 'assessments', label: 'Assessments', icon: ClipboardList, floor: 'super', render: () => <AssessmentsPage /> },
      { key: 'flags', label: 'Feature flags', icon: Flag, floor: 'super', render: () => <FeatureFlagsPage /> },
    ],
  },
  {
    label: 'Integrations',
    sections: [
      { key: 'integrations', label: 'Integrations', icon: Network, floor: 'admin', render: () => <IntegrationsPage /> },
      { key: 'webhooks', label: 'Webhooks', icon: Webhook, floor: 'admin', render: () => <WebhooksPage /> },
      { key: 'operator-queue', label: 'Operator queue', icon: Inbox, floor: 'admin', render: () => <ActionLayerPage /> },
    ],
  },
  {
    label: 'Support',
    sections: [
      { key: 'support-console', label: 'Support console', icon: Headset, floor: 'support', render: () => <SupportConsolePage /> },
      { key: 'support-triage', label: 'Support triage', icon: ListFilter, floor: 'admin', render: () => <SupportTriagePage /> },
      { key: 'impersonate', label: 'Impersonate', icon: UserSearch, floor: 'support', render: () => <ImpersonationPage /> },
      { key: 'incidents', label: 'Incident manager', icon: AlertTriangle, floor: 'support', render: () => <StatusIncidentsAdminPage /> },
    ],
  },
  {
    label: 'Governance',
    sections: [
      { key: 'compliance', label: 'Compliance', icon: BadgeCheck, floor: 'admin', render: () => <CompliancePage /> },
    ],
  },
];

export function ConsolePage() {
  const role = useAppStore((s) => s.user?.role);
  const isSuper = role === 'superadmin';
  const isSupport = isSuper || role === 'support_admin';
  const isAdmin = isSupport || role === 'admin';
  const canSee = (f: Floor) => (f === 'admin' && isAdmin) || (f === 'support' && isSupport) || (f === 'super' && isSuper);

  const visibleGroups = GROUPS
    .map((g) => ({ label: g.label, sections: g.sections.filter((s) => canSee(s.floor)) }))
    .filter((g) => g.sections.length > 0);
  const flat = visibleGroups.flatMap((g) => g.sections);

  const [params, setParams] = useSearchParams();
  const requested = params.get('section');
  const current = flat.find((s) => s.key === requested) ?? flat[0];

  // Brand river over the groups — GROUPS is static, so role + active section
  // fully determine the graph; memoised so the canvas doesn't remount.
  const activeLabel = visibleGroups.find((g) => g.sections.some((s) => s.key === current?.key))?.label;
  const navGraph = useMemo(
    () => consoleNavRiver(
      visibleGroups.map((g) => ({ key: g.label, title: g.label, sections: g.sections.length })),
      activeLabel,
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleGroups derives from static GROUPS + role
    [role, activeLabel],
  );
  const navOpts = useMemo(() => ({
    onNodeClick: (id: string) => {
      const first = visibleGroups.find((g) => g.label === id)?.sections[0];
      if (first) setParams({ section: first.key }, { replace: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same derivation
  }), [role, setParams]);

  if (!current) {
    // No section visible to this role — the route floor should prevent it, but
    // never render a blank shell.
    return <p className="t-muted p-6">No console surfaces are available for your role.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2 pb-1">
        <p className="text-sm font-semibold t-primary">Console</p>
        <p className="text-sm t-secondary">Platform administration — tenancy, access, platform operations, integrations, support and governance in one place.</p>
      </header>

      {/* Group-nav river — the brand flow, one node per group this role can
          see; real section counts, click jumps to the group's first section. */}
      <div className="hidden md:block">
        <MiniRiver graph={navGraph} opts={navOpts} label="Console areas available to your role" />
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left rail — grouped section switcher. One mount at a time. */}
        <nav className="md:w-56 shrink-0" aria-label="Console sections">
          <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {visibleGroups.map((g) => (
              <li key={g.label} className="md:mb-2">
                <p className="hidden md:block text-[10px] tracking-[0.16em] uppercase font-bold t-muted px-3 pt-2 pb-1">{g.label}</p>
                <ul className="flex md:flex-col gap-1">
                  {g.sections.map((s) => {
                    const on = s.key === current.key;
                    const Icon = s.icon;
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          aria-current={on ? 'page' : undefined}
                          onClick={() => setParams({ section: s.key }, { replace: true })}
                          className={`w-full inline-flex items-center gap-2.5 whitespace-nowrap px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            on ? 'text-accent' : 't-secondary hover:t-primary hover:bg-[var(--bg-card-hover)]'
                          }`}
                          style={on ? { background: 'var(--accent-subtle)' } : undefined}
                        >
                          <Icon size={15} className={on ? 'text-accent' : 't-muted'} aria-hidden="true" />
                          {s.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        {/* Panel — the mounted admin surface, code-split, lazy-loaded. */}
        <section className="flex-1 min-w-0" role="region" aria-label={current.label}>
          <Suspense fallback={<div className="flex items-center justify-center min-h-[40vh]"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>}>
            {current.render()}
          </Suspense>
        </section>
      </div>
    </div>
  );
}

export default ConsolePage;
