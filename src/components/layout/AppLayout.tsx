// One frontend: every route that used to get the old Sidebar+Header chrome now
// renders inside the rx SubPage shell — same look as /x/ops. This layout keeps
// only the auth bootstrap; all chrome lives in Shell/SubPage.
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { SubPage } from "@/x/SubPage";
import { DemoEnvironmentBanner } from "./DemoEnvironmentBanner";
import { useAppStore } from "@/stores/appStore";
import { api, ApiError, getToken, setToken } from "@/lib/api";
import { Loader2 } from "lucide-react";
import { clearChunkReloadGuard } from "@/lib/lazy-with-retry";

// Longest-prefix wins (order matters: /support-tickets before /support).
const TITLES: Array<[string, string]> = [
  ['/admin/tenants', 'Tenants'],
  ['/admin/incidents', 'Status incidents'],
  ['/support-tickets', 'Support tickets'],
  ['/support-triage', 'Support triage'],
  ['/dashboard', 'Home'],
  ['/onboarding', 'Onboarding'],
  ['/board', 'Board digest'],
  ['/mind', 'Mind'],
  ['/memory', 'Memory'],
  ['/console', 'Admin'],
  ['/tenants', 'Tenants'],
  ['/iam', 'IAM'],
  ['/control-plane', 'Control plane'],
  ['/integrations', 'Integrations'],
  ['/action-layer', 'Action layer'],
  ['/deployments', 'Deployments'],
  ['/assessments', 'Assessments'],
  ['/platform-health', 'Platform health'],
  ['/support', 'Support'],
  ['/impersonate', 'Impersonation'],
  ['/bulk-users', 'Bulk users'],
  ['/custom-roles', 'Custom roles'],
  ['/revenue', 'Revenue & usage'],
  ['/feature-flags', 'Feature flags'],
  ['/system-alerts', 'System alerts'],
  ['/webhooks', 'Webhooks'],
];

export function AppLayout() {
  const { user, setUser } = useAppStore();
  const loadCompanies = useAppStore((s) => s.loadCompanies);
  const loadCurrency = useAppStore((s) => s.loadCurrency);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setChecking(false);
      navigate('/login', { replace: true });
      return;
    }
    if (user) {
      setChecking(false);
      return;
    }
    api.auth.me()
      .then((me) => {
        setUser({
          id: me.id,
          email: me.email,
          name: me.name,
          role: me.role as 'admin' | 'executive' | 'manager' | 'analyst' | 'operator',
          tenantId: me.tenantId,
          tenantName: me.tenantName,
          permissions: me.permissions,
          // Whitelabel — backend always returns a `brand` block; default to
          // null fields so the BrandProvider clears any prior tenant state.
          brand: me.brand
            ? { logoUrl: me.brand.logoUrl, primaryColor: me.brand.primaryColor, nameOverride: me.brand.nameOverride }
            : { logoUrl: null, primaryColor: null, nameOverride: null },
        });
      })
      .catch((err) => {
        // Only a real 401 invalidates the session. 429/5xx/network failures
        // on /me are transient — keep tokens so the next load recovers
        // instead of destroying a valid session.
        if (err instanceof ApiError && err.status === 401) setToken(null);
        navigate('/login', { replace: true });
      })
      .finally(() => setChecking(false));
  }, [user, navigate, setUser]);

  // Load the tenant's ERP companies once we have an authenticated user so the
  // company-switcher has data. Also re-runs if the active tenant id changes
  // (platform admin switched tenants).
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  useEffect(() => {
    if (!user) return;
    loadCompanies();
    loadCurrency();
  }, [user, activeTenantId, loadCompanies, loadCurrency]);

  // Clear the chunk-load reload guard once the layout mounts successfully.
  // This lets a subsequent stale-cache scenario (mid-session second deploy)
  // self-heal via lazyWithRetry — the user gets one auto-reload per session
  // per stale-bundle event.
  useEffect(() => {
    clearChunkReloadGuard();
  }, []);

  // TASK-006: Global keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") document.dispatchEvent(new CustomEvent("atheon:escape"));
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        document.dispatchEvent(new CustomEvent("atheon:help"));
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (!user) return null;

  const title = TITLES.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? 'Atheon';

  return (
    <>
      <DemoEnvironmentBanner />
      <SubPage title={title}>
        <Outlet />
      </SubPage>
    </>
  );
}
