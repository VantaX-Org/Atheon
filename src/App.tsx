import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { ApexPage } from "@/pages/ApexPage";
import { PulsePage } from "@/pages/PulsePage";
import { CatalystsPage } from "@/pages/CatalystsPage";
import { MindPage } from "@/pages/MindPage";
import { MemoryPage } from "@/pages/MemoryPage";
import { ChatPage } from "@/pages/ChatPage";
import { ConnectivityPage } from "@/pages/ConnectivityPage";
import { AuditPage } from "@/pages/AuditPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MFASetupPage } from "@/pages/MFASetupPage";
import { TenantsPage } from "@/pages/TenantsPage";
import { IAMPage } from "@/pages/IAMPage";
import { ControlPlanePage } from "@/pages/ControlPlanePage";
import { IntegrationsPage } from "@/pages/IntegrationsPage";
import { LoginPage } from "@/pages/LoginPage";
import { MarketingPage } from "@/pages/MarketingPage";
import { DeploymentsPage } from "@/pages/DeploymentsPage";
import { AssessmentsPage } from "@/pages/AssessmentsPage";
import { CatalystRunDetailPage } from "@/pages/CatalystRunDetailPage";
import { ERPOAuthCallbackPage } from "@/pages/ERPOAuthCallbackPage";
import { TenantManagementPage } from "@/pages/TenantManagementPage";
import { TenantLlmBudgetPage } from "@/pages/admin/TenantLlmBudgetPage";
import { TrialPage } from "@/pages/TrialPage";
import { ExecutiveSummaryPage } from "@/pages/ExecutiveSummaryPage";
import { VerifyEmailPage } from "@/pages/VerifyEmailPage";
import { PlatformHealthPage } from "@/pages/PlatformHealthPage";
import { SupportConsolePage } from "@/pages/SupportConsolePage";
import { CompanyHealthPage } from "@/pages/CompanyHealthPage";
import { ImpersonationPage } from "@/pages/ImpersonationPage";
import { BulkUserManagementPage } from "@/pages/BulkUserManagementPage";
import { CustomRoleBuilderPage } from "@/pages/CustomRoleBuilderPage";
import { RevenueUsagePage } from "@/pages/RevenueUsagePage";
import { FeatureFlagsPage } from "@/pages/FeatureFlagsPage";
import { DataGovernancePage } from "@/pages/DataGovernancePage";
import { IntegrationHealthPage } from "@/pages/IntegrationHealthPage";
import { SystemAlertsPage } from "@/pages/SystemAlertsPage";
import { WebhooksPage } from "@/pages/WebhooksPage";
import { useAppStore } from "@/stores/appStore";
import type { UserRole } from "@/types";

/**
 * 3.10: Role-based frontend route protection
 * Only admin and executive roles can access platform management pages
 */
function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: UserRole[] }) {
  const user = useAppStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!allowedRoles.includes(user.role)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <h2 className="text-xl font-semibold text-white">Access Denied</h2>
          <p className="text-sm text-gray-500">You do not have permission to access this page.</p>
          <p className="text-xs text-gray-400">Required role: {allowedRoles.join(', ')}</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

const SUPERADMIN_ROLES: UserRole[] = ['superadmin'];
const SUPPORT_ROLES: UserRole[] = ['superadmin', 'support_admin'];
const PLATFORM_ADMIN_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin'];
const EXECUTIVE_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive'];
const MANAGER_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager'];
const OPERATOR_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'operator'];
const STANDARD_ROLES: UserRole[] = ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator'];

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MarketingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<LoginPage />} />
        <Route path="/trial" element={<TrialPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/erp/oauth/callback" element={<ERPOAuthCallbackPage />} />
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/apex" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ApexPage /></ProtectedRoute>} />
          <Route path="/pulse" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><PulsePage /></ProtectedRoute>} />
          <Route path="/catalysts" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystsPage /></ProtectedRoute>} />
          <Route path="/catalysts/runs/:runId" element={<ProtectedRoute allowedRoles={OPERATOR_ROLES}><CatalystRunDetailPage /></ProtectedRoute>} />
          <Route path="/mind" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><MindPage /></ProtectedRoute>} />
          <Route path="/memory" element={<ProtectedRoute allowedRoles={MANAGER_ROLES}><MemoryPage /></ProtectedRoute>} />
          <Route path="/chat" element={<ProtectedRoute allowedRoles={STANDARD_ROLES}><ChatPage /></ProtectedRoute>} />
          <Route path="/connectivity" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><ConnectivityPage /></ProtectedRoute>} />
          <Route path="/audit" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><AuditPage /></ProtectedRoute>} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/mfa" element={<MFASetupPage />} />
          <Route path="/admin/tenants" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantManagementPage /></ProtectedRoute>} />
          <Route path="/admin/tenants/:id/llm" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantLlmBudgetPage /></ProtectedRoute>} />
          <Route path="/tenants" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><TenantsPage /></ProtectedRoute>} />
          <Route path="/iam" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IAMPage /></ProtectedRoute>} />
          <Route path="/control-plane" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><ControlPlanePage /></ProtectedRoute>} />
          <Route path="/integrations" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IntegrationsPage /></ProtectedRoute>} />
          <Route path="/canonical-api" element={<Navigate to="/integrations" replace />} />
          <Route path="/erp-adapters" element={<Navigate to="/integrations" replace />} />
          <Route path="/deployments" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><DeploymentsPage /></ProtectedRoute>} />
          <Route path="/assessments" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><AssessmentsPage /></ProtectedRoute>} />
          {/* /executive was the retired ExecutiveMobilePage — now consolidated
              into the responsive ApexPage (mobile KPI strip, pull-to-refresh,
              and tight 3-card above-fold layout). Redirect preserves old links. */}
          <Route path="/executive" element={<Navigate to="/apex" replace />} />
          <Route path="/executive-summary" element={<ProtectedRoute allowedRoles={EXECUTIVE_ROLES}><ExecutiveSummaryPage /></ProtectedRoute>} />
          {/* Admin Tooling Routes (ADMIN-001 to ADMIN-012) */}
          <Route path="/platform-health" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><PlatformHealthPage /></ProtectedRoute>} />
          <Route path="/support" element={<ProtectedRoute allowedRoles={SUPPORT_ROLES}><SupportConsolePage /></ProtectedRoute>} />
          <Route path="/company-health" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><CompanyHealthPage /></ProtectedRoute>} />
          <Route path="/impersonate" element={<ProtectedRoute allowedRoles={SUPPORT_ROLES}><ImpersonationPage /></ProtectedRoute>} />
          <Route path="/bulk-users" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><BulkUserManagementPage /></ProtectedRoute>} />
          <Route path="/custom-roles" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><CustomRoleBuilderPage /></ProtectedRoute>} />
          <Route path="/revenue" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><RevenueUsagePage /></ProtectedRoute>} />
          <Route path="/feature-flags" element={<ProtectedRoute allowedRoles={SUPERADMIN_ROLES}><FeatureFlagsPage /></ProtectedRoute>} />
          <Route path="/data-governance" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><DataGovernancePage /></ProtectedRoute>} />
          <Route path="/integration-health" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><IntegrationHealthPage /></ProtectedRoute>} />
          <Route path="/system-alerts" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><SystemAlertsPage /></ProtectedRoute>} />
          <Route path="/webhooks" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
          <Route path="/webhooks/:webhookId" element={<ProtectedRoute allowedRoles={PLATFORM_ADMIN_ROLES}><WebhooksPage /></ProtectedRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
