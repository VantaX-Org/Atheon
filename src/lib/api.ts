// M5 fix: Use env variable with production fallback (not personal Workers subdomain)
export const API_URL = import.meta.env.VITE_API_URL || 'https://atheon-api.vantax.co.za';

let authToken: string | null = localStorage.getItem('atheon_token');
let refreshToken: string | null = localStorage.getItem('atheon_refresh_token');
let tenantOverrideId: string | null = localStorage.getItem('atheon_tenant_override');
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

// M6: Rate limit state exposed to UI
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
}
let lastRateLimitInfo: RateLimitInfo = { limit: null, remaining: null, resetAt: null };
export function getRateLimitInfo(): RateLimitInfo { return lastRateLimitInfo; }

export function setToken(token: string | null, refresh?: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('atheon_token', token);
  } else {
    localStorage.removeItem('atheon_token');
  }
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) {
      localStorage.setItem('atheon_refresh_token', refresh);
    } else {
      localStorage.removeItem('atheon_refresh_token');
    }
  }
}

export function getToken(): string | null {
  return authToken;
}

/** Set a global tenant override for cross-tenant access (superadmin/support_admin) */
export function setTenantOverride(tenantId: string | null) {
  tenantOverrideId = tenantId;
  if (tenantId) {
    localStorage.setItem('atheon_tenant_override', tenantId);
  } else {
    localStorage.removeItem('atheon_tenant_override');
  }
}

export function getTenantOverride(): string | null {
  return tenantOverrideId;
}

/** Build query string from params, omitting undefined/null values */
function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null) as [string, string][];
  return entries.length ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

// H4: Attempt to refresh the access token using the stored refresh token
async function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { token: string; refreshToken?: string };
    setToken(data.token, data.refreshToken || refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Inject global tenant override into URL if set and not already present
  let finalPath = path;
  if (tenantOverrideId && !path.includes('tenant_id=') && !path.startsWith('/api/auth') && !path.startsWith('/api/tenants')) {
    const sep = path.includes('?') ? '&' : '?';
    finalPath = `${path}${sep}tenant_id=${encodeURIComponent(tenantOverrideId)}`;
  }

  const res = await fetch(`${API_URL}${finalPath}`, {
    ...options,
    headers,
  });

  // M6: Read rate limit headers from response
  const rlLimit = res.headers.get('X-RateLimit-Limit');
  const rlRemaining = res.headers.get('X-RateLimit-Remaining');
  if (rlLimit || rlRemaining) {
    lastRateLimitInfo = {
      limit: rlLimit ? parseInt(rlLimit, 10) : lastRateLimitInfo.limit,
      remaining: rlRemaining ? parseInt(rlRemaining, 10) : lastRateLimitInfo.remaining,
      resetAt: null,
    };
  }

  // H4: 401 interceptor — attempt token refresh and retry once
  if (res.status === 401 && authToken && !path.startsWith('/api/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = attemptTokenRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;

    if (refreshed) {
      // Retry the original request with the new token
      headers['Authorization'] = `Bearer ${authToken}`;
      const retryRes = await fetch(`${API_URL}${finalPath}`, { ...options, headers });
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
        throw new Error((err as Record<string, string>).error || retryRes.statusText);
      }
      return retryRes.json() as Promise<T>;
    } else {
      // Refresh failed — clear tokens and redirect to login
      setToken(null, null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?session_expired=1';
      }
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<T>;
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string, tenantSlug?: string) =>
      request<{ token: string; user: AuthUser; tenantSelectionRequired?: boolean; tenants?: { slug: string; name: string }[] }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(tenantSlug ? { tenant_slug: tenantSlug } : {}) }),
      }),
    register: (email: string, password: string, name: string, tenantSlug?: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, tenant_slug: tenantSlug || 'vantax' }),
      }),
    changePassword: (newPassword: string, currentPassword?: string) =>
      request<{ success: boolean; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword, current_password: currentPassword }),
      }),
    me: () => request<AuthUser>('/api/auth/me'),
    ssoLogin: (provider: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      }),
    ssoAuthorize: (provider: string, tenantSlug?: string) =>
      request<{ redirect_url: string }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ provider, tenant_slug: tenantSlug || 'vantax' }),
      }),
    ssoCallback: (code: string, state: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/sso/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }),
    logout: () =>
      request<{ success: boolean; message: string }>('/api/auth/logout', { method: 'POST' }),
    forgotPassword: (email: string) =>
      request<{ success: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, newPassword: string) =>
      request<{ success: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
      }),
    // Phase 4.4: MFA endpoints
    mfaSetup: () =>
      request<{ secret: string; otpauthUri: string }>('/api/auth/mfa/setup', { method: 'POST' }),
    mfaVerify: (code: string) =>
      request<{ success: boolean }>('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
    // API key management
    listApiKeys: () =>
      request<{ keys: { id: string; name: string; prefix: string; createdAt: string; lastUsed: string | null }[] }>('/api/auth/api-keys'),
    generateApiKey: (name?: string) =>
      request<{ id: string; name: string; key: string; prefix: string; message: string }>('/api/auth/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    revokeApiKey: (id: string) =>
      request<{ success: boolean }>(`/api/auth/api-keys/${id}`, { method: 'DELETE' }),
  },

  tenants: {
    list: () => request<{ tenants: Tenant[]; total: number }>('/api/tenants'),
    get: (id: string) => request<TenantDetail>(`/api/tenants/${id}`),
    create: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/tenants', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateEntitlements: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/tenants/${id}/entitlements`, { method: 'PUT', body: JSON.stringify(data) }),
    reset: (id: string) =>
      request<{ success: boolean; deletedRows: number; tablesCleared: number }>(`/api/tenants/${id}/reset`, { method: 'POST' }),
    delete: (id: string) =>
      request<{ success: boolean; deletedRows: number; tablesCleared: number }>(`/api/tenants/${id}`, { method: 'DELETE' }),
    archive: (id: string) =>
      request<{ success: boolean; clustersDeactivated: number; agentsDeactivated: number }>(`/api/tenants/${id}/archive`, { method: 'POST' }),
    unarchive: (id: string) =>
      request<{ success: boolean }>(`/api/tenants/${id}/unarchive`, { method: 'POST' }),
    seedVantax: () =>
      request<{ success: boolean; message: string; seeded: { clusters: number; subCatalysts: number; positiveRuns: { count: number; totalItems: number; matchRate: number }; negativeRuns: { count: number; totalItems: number; matchRate: number }; metrics: number; risks: number; healthScore: number } }>('/api/v1/seed-vantax/seed-vantax', { method: 'POST' }),
    // Spec 7 POPIA: Data export and erasure
    dataExport: () =>
      request<{ success: boolean; exportedAt: string; tableCount: number; totalRecords: number; data: Record<string, unknown[]> }>('/api/tenants/data-export'),
    dataErasure: () =>
      request<{ success: boolean; erasedAt: string; erasureLog: { table: string; action: string; affected: number }[]; preservedTables: string[] }>('/api/tenants/data-export', { method: 'DELETE' }),
  },

  iam: {
    policies: (tenantId?: string) =>
      request<{ policies: IAMPolicy[]; total: number }>(`/api/iam/policies${qs({ tenant_id: tenantId })}`),
    roles: (tenantId?: string) =>
      request<{ roles: IAMRole[] }>(`/api/iam/roles${qs({ tenant_id: tenantId })}`),
    users: (tenantId?: string) =>
      request<{ users: IAMUser[]; total: number }>(`/api/iam/users${qs({ tenant_id: tenantId })}`),
    sso: (tenantId?: string) =>
      request<{ configs: SSOConfig[] }>(`/api/iam/sso${qs({ tenant_id: tenantId })}`),
    createUser: (data: Record<string, unknown>, tenantId?: string) =>
      request<{ id: string }>(`/api/iam/users${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify(data) }),
    createPolicy: (data: Record<string, unknown>) =>
      request<{ id: string; name: string }>('/api/iam/policies', { method: 'POST', body: JSON.stringify(data) }),
    deletePolicy: (id: string) =>
      request<{ success: boolean }>(`/api/iam/policies/${id}`, { method: 'DELETE' }),
    // Phase 4.5: User management
    updateUser: (id: string, data: Record<string, unknown>, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    resendWelcome: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}/resend-welcome${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
  },

  apex: {
    health: (tenantId?: string, industry?: string) =>
      request<HealthScore>(`/api/apex/health${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    briefing: (tenantId?: string, industry?: string) =>
      request<Briefing>(`/api/apex/briefing${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    risks: (tenantId?: string, industry?: string) =>
      request<{ risks: Risk[]; total: number }>(`/api/apex/risks${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    scenarios: (tenantId?: string, industry?: string) =>
      request<{ scenarios: ScenarioItem[]; total: number }>(`/api/apex/scenarios${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createScenario: (data: Record<string, unknown>) =>
      request<{ id: string; results: Record<string, unknown>; context?: Record<string, unknown> }>('/api/apex/scenarios', { method: 'POST', body: JSON.stringify(data) }),
    // A1-3: Health score history
    healthHistory: (tenantId?: string, limit?: number) =>
      request<HealthHistoryResponse>(`/api/apex/health/history${qs({ tenant_id: tenantId, limit: limit?.toString() })}`),
    // A1-4: Health dimension traceability
    healthDimension: (dimension: string, tenantId?: string) =>
      request<HealthDimensionTraceResponse>(`/api/apex/health/dimensions/${encodeURIComponent(dimension)}${qs({ tenant_id: tenantId })}`),
    // A4-4: Risk traceability
    riskTrace: (riskId: string, tenantId?: string) =>
      request<RiskTraceResponse>(`/api/apex/risks/${riskId}/trace${qs({ tenant_id: tenantId })}`),
    riskSuggestCauses: (riskId: string, tenantId?: string) =>
      request<{ success: boolean; riskId: string; analysis: { rootCauses: Array<{ description: string; confidence: number; immediateAction: string; longTermFix: string; affectedSystems: string[] }>; generatedAt: string; model: string } }>(`/api/apex/risks/${riskId}/suggest-causes${qs({ tenant_id: tenantId })}`),
    riskExport: (riskId: string, tenantId?: string) =>
      fetch(`/api/apex/risks/${riskId}/export${qs({ tenant_id: tenantId })}`, { headers: { 'Content-Type': 'text/csv' } }).then(r => r.blob()),
    // Insights engine: AI-powered executive insights
    insights: (tenantId?: string) =>
      request<ApexInsightsResponse>(`/api/apex/insights${qs({ tenant_id: tenantId })}`),
    // Dashboard intelligence: unified summary
    dashboardIntelligence: (tenantId?: string) =>
      request<DashboardIntelligenceResponse>(`/api/apex/dashboard-intelligence${qs({ tenant_id: tenantId })}`),
  },

  pulse: {
    metrics: (tenantId?: string, industry?: string) =>
      request<{ metrics: Metric[]; total: number }>(`/api/pulse/metrics${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    anomalies: (tenantId?: string, industry?: string) =>
      request<{ anomalies: AnomalyItem[]; total: number }>(`/api/pulse/anomalies${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    detectAnomalies: (metricId?: string, sensitivity?: 'low' | 'medium' | 'high', tenantId?: string) =>
      request<{ success: boolean; statistics: { mean: number; stdDev: number; dataPoints: number; period: string }; detected: unknown[]; count: number }>(`/api/pulse/anomalies/detect${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify({ metric_id: metricId, sensitivity }) }),
    processes: (tenantId?: string, industry?: string) =>
      request<{ processes: ProcessItem[]; total: number }>(`/api/pulse/processes${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    correlations: (tenantId?: string, industry?: string) =>
      request<{ correlations: CorrelationItem[]; total: number }>(`/api/pulse/correlations${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    summary: (tenantId?: string, industry?: string) =>
      request<PulseSummary>(`/api/pulse/summary${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    refresh: (tenantId?: string) =>
      request<{ refreshed: boolean; processFlows?: number; metricsGenerated?: number; catalystActions?: number; message?: string }>(`/api/pulse/refresh${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    catalystRuns: (tenantId?: string, catalyst?: string) =>
      request<{ runs: CatalystRunItem[]; summary: CatalystRunSummary[]; total: number }>(`/api/pulse/catalyst-runs${qs({ tenant_id: tenantId, catalyst })}`),
    // P1-4: Metric traceability
    metricTrace: (metricId: string, tenantId?: string) =>
      request<MetricTraceResponse>(`/api/pulse/metrics/${metricId}/trace${qs({ tenant_id: tenantId })}`),
    // Insights engine: AI-powered operational insights
    insights: (domain?: string, tenantId?: string) =>
      request<PulseInsightsResponse>(`/api/pulse/insights${qs({ tenant_id: tenantId, domain })}`),
    // Department domains available for filtering
    domains: (tenantId?: string) =>
      request<{ domains: string[] }>(`/api/pulse/domains${qs({ tenant_id: tenantId })}`),
  },

  catalysts: {
    clusters: (tenantId?: string, industry?: string) =>
      request<{ clusters: ClusterItem[]; total: number }>(`/api/catalysts/clusters${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    toggleSubCatalyst: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/toggle${qs({ tenant_id: tenantId })}`, { method: 'PUT' }),
    setDataSource: (clusterId: string, subName: string, dataSource: { type: string; config: Record<string, unknown> }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(dataSource) }),
    removeDataSource: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    setDataSources: (clusterId: string, subName: string, dataSources: DataSourceConfig[], tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-sources${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify({ data_sources: dataSources }) }),
    removeDataSourceByIndex: (clusterId: string, subName: string, index: number, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-sources/${index}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    setFieldMappings: (clusterId: string, subName: string, mappings: FieldMapping[], tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/field-mappings${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify({ field_mappings: mappings }) }),
    suggestFieldMappings: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ suggestions: FieldMapping[] }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/field-mappings/suggest${qs({ tenant_id: tenantId })}`),
    setExecutionConfig: (clusterId: string, subName: string, config: ExecutionConfig, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/execution-config${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(config) }),
    executeSubCatalyst: (clusterId: string, subName: string, tenantId?: string) =>
      request<ExecutionResult>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/execute${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    getExecutionHistory: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ executions: ExecutionResult[]; total: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/executions${qs({ tenant_id: tenantId })}`),
    setSchedule:(clusterId: string, subName: string, schedule: { frequency: string; day_of_week?: number; day_of_month?: number; time_of_day?: string }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(schedule) }),
    removeSchedule: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    cluster: (id: string) => request<ClusterDetail>(`/api/catalysts/clusters/${id}`),
    actions: (tenantId?: string, clusterId?: string, industry?: string) =>
      request<{ actions: ActionItem[]; total: number }>(`/api/catalysts/actions${qs({ tenant_id: tenantId, cluster_id: clusterId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createAction: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/catalysts/actions', { method: 'POST', body: JSON.stringify(data) }),
    approveAction: (id: string, approvedBy?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/approve`, { method: 'PUT', body: JSON.stringify({ approved_by: approvedBy || 'ui' }) }),
    rejectAction: (id: string, rejectedBy?: string, reason?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/reject`, { method: 'PUT', body: JSON.stringify({ approved_by: rejectedBy || 'ui', reason: reason || '' }) }),
    governance: (tenantId?: string, industry?: string) =>
      request<GovernanceData>(`/api/catalysts/governance${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createCluster: (data: Record<string, unknown>) =>
      request<{ id: string; name: string; domain: string }>('/api/catalysts/clusters', { method: 'POST', body: JSON.stringify(data) }),
    deleteCluster: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/catalysts/clusters/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    templates: () =>
      request<{ templates: CatalystIndustryTemplate[] }>('/api/catalysts/templates'),
    deployTemplate: (data: { tenant_id: string; industry: string; clusters?: Array<{ name: string; domain: string; description: string; autonomy_tier: string; sub_catalysts: Array<{ name: string; enabled: boolean; description: string }> }> }) =>
      request<{ success: boolean; industry: string; clustersCreated: number; clusterIds: string[]; existingClusters: number }>('/api/catalysts/deploy-template', { method: 'POST', body: JSON.stringify(data) }),
    manualExecute: async (data: FormData): Promise<ManualExecuteResult> => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      // Include tenant override for cross-tenant manual execution
      let url = `${API_URL}/api/catalysts/manual-execute`;
      if (tenantOverrideId) {
        url += `?tenant_id=${encodeURIComponent(tenantOverrideId)}`;
      }
      const res = await fetch(url, {
        method: 'POST', headers, body: data,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as Record<string, string>).error || res.statusText);
      }
      return res.json() as Promise<ManualExecuteResult>;
    },
    executionLogs: (actionId?: string) =>
      request<{ logs: ExecutionLogEntry[]; total: number }>(`/api/catalysts/execution-logs${qs({ action_id: actionId })}`) ,
    executionLogsForAction: (actionId: string) =>
      request<{ logs: ExecutionLogEntry[]; total: number }>(`/api/catalysts/execution-logs/${actionId}`),
    resolveException: (actionId: string, notes?: string) =>
      request<{ success: boolean; status: string }>(`/api/catalysts/actions/${actionId}/resolve`, {
        method: 'PUT', body: JSON.stringify({ resolution_notes: notes || 'Resolved by admin' }),
      }),
    escalateException: (actionId: string, notes?: string, escalateTo?: string) =>
      request<{ success: boolean; status: string; escalationLevel: string }>(`/api/catalysts/actions/${actionId}/escalate`, {
        method: 'PUT', body: JSON.stringify({ escalation_notes: notes, escalated_to: escalateTo }),
      }),
    assignAction: (actionId: string, assignedTo: string) =>
      request<{ success: boolean; assignedTo: string; userName: string; userEmail: string }>(`/api/catalysts/actions/${actionId}/assign`, {
        method: 'PUT', body: JSON.stringify({ assigned_to: assignedTo }),
      }),
    hitlConfig: (clusterId?: string, tenantId?: string, subCatalystName?: string) =>
      request<{ config?: HitlConfig | null; configs?: HitlConfigListItem[]; subConfigs?: HitlConfigListItem[]; users?: Record<string, { email: string; name: string }> }>(`/api/catalysts/hitl-config${qs({ cluster_id: clusterId, tenant_id: tenantId, sub_catalyst_name: subCatalystName })}`),
    saveHitlConfig: (data: { cluster_id: string; sub_catalyst_name?: string; domain?: string; validator_user_ids?: string[]; exception_handler_user_ids?: string[]; escalation_user_ids?: string[]; notify_on_completion?: boolean; notify_on_exception?: boolean; notify_on_approval_needed?: boolean }) =>
      request<{ id: string; created?: boolean; updated?: boolean }>('/api/catalysts/hitl-config', { method: 'PUT', body: JSON.stringify(data) }),
    deleteHitlConfig: (clusterId: string, subCatalystName?: string) =>
      request<{ success: boolean }>(`/api/catalysts/hitl-config/${clusterId}${qs({ sub_catalyst_name: subCatalystName })}`, { method: 'DELETE' }),
    sendRunReport: (clusterId: string, catalystName?: string) =>
      request<{ success: boolean; actionCount: number; message: string }>('/api/catalysts/send-run-report', { method: 'POST', body: JSON.stringify({ cluster_id: clusterId, catalyst_name: catalystName }) }),
    runAnalytics: (clusterId?: string, subCatalystName?: string, limit?: number) =>
      request<{ runs: RunAnalytics[]; aggregate: RunAnalyticsAggregate }>(`/api/catalysts/run-analytics${qs({ cluster_id: clusterId, sub_catalyst_name: subCatalystName, limit: limit?.toString() })}`),
    runAnalyticsDetail: (runId: string) =>
      request<{ analytics: RunAnalytics; actions: Array<{ id: string; action: string; status: string; confidence: number; assignedTo?: string; processingTimeMs?: number; createdAt: string }> }>(`/api/catalysts/run-analytics/${runId}`),
    recordRunAnalytics: (data: { cluster_id: string; sub_catalyst_name?: string; run_id?: string; actions: Array<{ action: string; status: string; confidence: number; processing_time_ms?: number }> }) =>
      request<{ id: string; runId: string; status: string; summary: { total: number; completed: number; exceptions: number; escalated: number; pending: number; autoApproved: number }; confidence: { avg: number; min: number; max: number; distribution: Record<string, number> }; insights: string[]; durationMs: number }>('/api/catalysts/run-analytics', { method: 'POST', body: JSON.stringify(data) }),

    // ── Sub-Catalyst Ops ──
    getSubCatalystRuns: (clusterId: string, subName: string, opts?: { limit?: number; offset?: number; status?: string; from?: string; to?: string; triggered_by?: string }) =>
      request<{ runs: SubCatalystRun[]; total: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/runs${qs({ limit: opts?.limit?.toString(), offset: opts?.offset?.toString(), status: opts?.status, from: opts?.from, to: opts?.to, triggered_by: opts?.triggered_by })}`),
    getSubCatalystRunDetail: (clusterId: string, subName: string, runId: string) =>
      request<SubCatalystRunDetail>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/runs/${runId}`),
    runDetail: (runId: string) =>
      request<{
        id: string; subCatalystName: string; clusterName: string; clusterDomain: string;
        status: string; matched: number; discrepancies: number; exceptions: number;
        totalValue: number; startedAt: string; completedAt: string;
        kpis: Array<{ name: string; value: number; status: string; unit: string; target: number }>;
        metrics: Array<{ id: string; name: string; value: number; unit: string; status: string }>;
        sourceData: Array<{ id: string; sourceSystem: string; recordType: string; value: number; status: string }>;
      }>(`/api/catalysts/runs/${runId}/detail`),
    getSubCatalystKpis: (clusterId: string, subName: string) =>
      request<{ kpis: KpisResponse | null }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpis`),
    getKpiDefinitions: (clusterId: string, subName: string) =>
      request<{ definitions: KpiDefinitionRow[] }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions`),
    updateKpiDefinition: (clusterId: string, subName: string, defId: string, data: { threshold_green?: number; threshold_amber?: number; threshold_red?: number; enabled?: boolean }) =>
      request<{ success: boolean }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions/${defId}`, { method: 'PUT', body: JSON.stringify(data) }),
    resetKpiDefinitions: (clusterId: string, subName: string) =>
      request<{ success: boolean; definitions_count: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions/reset`, { method: 'PUT' }),
    updateSubCatalystThresholds: (clusterId: string, subName: string, thresholds: Record<string, number>) =>
      request<{ success: boolean; kpis: SubCatalystKpis }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpis/thresholds`, { method: 'PUT', body: JSON.stringify(thresholds) }),
    getRunItems: (runId: string, opts?: { limit?: number; offset?: number; status?: string; severity?: string; review_status?: string }) =>
      request<SubCatalystRunItemsResponse>(`/api/catalysts/runs/${runId}/items${qs({ limit: opts?.limit?.toString(), offset: opts?.offset?.toString(), status: opts?.status, severity: opts?.severity, review_status: opts?.review_status })}`),
    reviewRunItem: (runId: string, itemId: string, data: { review_status: string; review_notes?: string; reclassified_to?: string }) =>
      request<{ success: boolean; review_status: string; review_complete: boolean }>(`/api/catalysts/runs/${runId}/items/${itemId}/review`, { method: 'PUT', body: JSON.stringify(data) }),
    bulkReviewRunItems: (runId: string, data: { item_ids: string[]; review_status: string; review_notes?: string }) =>
      request<{ success: boolean; updated: number; review_complete: boolean }>(`/api/catalysts/runs/${runId}/items/bulk-review`, { method: 'PUT', body: JSON.stringify(data) }),
    exportRunItems: (runId: string) => `${API_URL}/api/catalysts/runs/${runId}/export`,
    retryRun: (runId: string) =>
      request<{ redirect: boolean; cluster_id: string; sub_catalyst_name: string; parent_run_id: string }>(`/api/catalysts/runs/${runId}/retry`, { method: 'POST' }),
    compareRuns: (runA: string, runB: string) =>
      request<SubCatalystRunComparison>(`/api/catalysts/runs/compare${qs({ run_a: runA, run_b: runB })}`),
    signOffRun: (runId: string, data: { status: string; notes?: string }) =>
      request<{ success: boolean; sign_off_status: string }>(`/api/catalysts/runs/${runId}/sign-off`, { method: 'PUT', body: JSON.stringify(data) }),
    getRunComments: (runId: string) =>
      request<{ comments: RunComment[] }>(`/api/catalysts/runs/${runId}/comments`),
    addRunComment: (runId: string, data: { comment: string; item_id?: string; comment_type?: string }) =>
      request<{ id: string; success: boolean }>(`/api/catalysts/runs/${runId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  },

  memory: {
    entities: (tenantId?: string, type?: string, industry?: string) =>
      request<{ entities: GraphEntity[]; total: number }>(`/api/memory/entities${qs({ tenant_id: tenantId, type, industry: industry && industry !== 'general' ? industry : undefined })}`),
    entity: (id: string) => request<GraphEntityDetail>(`/api/memory/entities/${id}`),
    relationships: (tenantId?: string, industry?: string) =>
      request<{ relationships: GraphRelationship[]; total: number }>(`/api/memory/relationships${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    graph: (tenantId?: string, industry?: string) =>
      request<GraphData>(`/api/memory/graph${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    query: (queryText: string, tenantId?: string) =>
      request<GraphQueryResult>('/api/memory/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tenant_id: tenantId }),
      }),
    stats: (tenantId?: string, industry?: string) =>
      request<GraphStats>(`/api/memory/stats${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
  },

  mind: {
    query: (queryText: string, tier?: string, tenantId?: string, industry?: string) =>
      request<MindQueryResult>('/api/mind/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tier: tier || 'tier-1', tenant_id: tenantId, industry: industry || undefined }),
      }),
    models: () => request<MindModels>('/api/mind/models'),
    history: (tenantId?: string, industry?: string) =>
      request<{ queries: MindHistoryItem[]; total: number }>(`/api/mind/history${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    stats: (tenantId?: string, industry?: string) =>
      request<MindStats>(`/api/mind/stats${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
  },

  erp: {
    adapters: () => request<{ adapters: ERPAdapter[]; total: number }>('/api/erp/adapters'),
    adapter: (id: string) => request<ERPAdapterDetail>(`/api/erp/adapters/${id}`),
    connections: (tenantId?: string) =>
      request<{ connections: ERPConnection[]; total: number }>(`/api/erp/connections${qs({ tenant_id: tenantId })}`),
    createConnection: (data: Record<string, unknown>) =>
      request<{ id: string; status: string }>('/api/erp/connections', { method: 'POST', body: JSON.stringify(data) }),
    updateConnection: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/erp/connections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteConnection: (id: string) =>
      request<{ success: boolean }>(`/api/erp/connections/${id}`, { method: 'DELETE' }),
    testConnection: (id: string) =>
      request<{ connected: boolean; message?: string }>(`/api/erp/connections/${id}/test`, { method: 'POST' }),
    canonical: (domain?: string) => {
      let url = '/api/erp/canonical';
      if (domain) url += `?domain=${domain}`;
      return request<{ endpoints: CanonicalEndpoint[]; total: number }>(url);
    },
    sync: (connectionId: string) =>
      request<{ recordsSynced: number; syncedAt: string }>(`/api/erp/sync/${connectionId}`, { method: 'POST' }),
  },

  controlplane: {
    deployments: (tenantId?: string, industry?: string) => {
      let url = '/api/controlplane/deployments';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      if (industry && industry !== 'general') url += `${tenantId ? '&' : '?'}industry=${industry}`;
      return request<{ deployments: DeploymentItem[]; total: number }>(url);
    },
    deployment: (id: string) => request<DeploymentItem>(`/api/controlplane/deployments/${id}`),
    createDeployment: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/controlplane/deployments', { method: 'POST', body: JSON.stringify(data) }),
    updateDeployment: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean; deployment?: DeploymentItem }>(`/api/controlplane/deployments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteDeployment: (id: string) =>
      request<{ success: boolean }>(`/api/controlplane/deployments/${id}`, { method: 'DELETE' }),
    health: (tenantId?: string, industry?: string) => {
      let url = '/api/controlplane/health';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      if (industry && industry !== 'general') url += `${tenantId ? '&' : '?'}industry=${industry}`;
      return request<ControlPlaneHealth>(url);
    },
  },

  audit: {
    log: (tenantId?: string, layer?: string) =>
      request<{ entries: AuditEntry[]; total: number }>(`/api/audit/log${qs({ tenant_id: tenantId, layer })}`),
    stats: (tenantId?: string) =>
      request<AuditStats>(`/api/audit/stats${qs({ tenant_id: tenantId })}`),
  },

  notifications: {
    list: (opts?: { unread?: boolean; limit?: number }) => {
      let url = '/api/notifications?';
      if (opts?.unread) url += 'unread=true&';
      if (opts?.limit) url += `limit=${opts.limit}&`;
      return request<{ notifications: NotificationItem[]; total: number; unreadCount: number }>(url);
    },
    unreadCount: () =>
      request<{ unreadCount: number }>('/api/notifications/unread-count'),
    markRead: (ids: string[]) =>
      request<{ success: boolean; marked: number }>('/api/notifications/read', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
  },

  // ── Hybrid Deployment Management ──────────────────────────────────────
  deployments: {
    list: () =>
      request<{ deployments: ManagedDeployment[]; total: number }>('/api/deployments'),
    get: (id: string) =>
      request<ManagedDeployment>(`/api/deployments/${id}`),
    create: (data: CreateDeploymentRequest) =>
      request<CreateDeploymentResponse>('/api/deployments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/deployments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    pushConfig: (id: string, config: Record<string, unknown>) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}/push-config`, { method: 'POST', body: JSON.stringify(config) }),
    pushUpdate: (id: string, version: string) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}/push-update`, { method: 'POST', body: JSON.stringify({ version }) }),
    getLogs: (id: string) =>
      request<{ logs: AgentErrorLog[] }>(`/api/deployments/${id}/logs`),
    revoke: (id: string) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}`, { method: 'DELETE' }),
  },

  // ── Pre-Assessment Tool ───────────────────────────────────────────────
  assessments: {
    list: () =>
      request<{ assessments: Assessment[]; total: number }>('/api/assessments'),
    get: (id: string) =>
      request<Assessment>(`/api/assessments/${id}`),
    create: (data: { prospect_name: string; prospect_industry: string; erp_connection_id?: string; config: Record<string, unknown> }) =>
      request<{ id: string; status: string }>('/api/assessments', { method: 'POST', body: JSON.stringify(data) }),
    status: (id: string) =>
      request<{ status: string; progress: string }>(`/api/assessments/${id}/status`),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/assessments/${id}`, { method: 'DELETE' }),
    getDefaultConfig: () =>
      request<Record<string, unknown>>('/api/assessments/config/defaults'),
    saveDefaultConfig: (config: Record<string, unknown>) =>
      request<{ success: boolean }>('/api/assessments/config/defaults', { method: 'PUT', body: JSON.stringify(config) }),
    downloadBusiness: async (id: string, assessment?: Assessment) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/business`, { headers });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `business-case-${id}.pdf`; a.click();
          URL.revokeObjectURL(url);
          return;
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side PDF generation
      if (assessment) {
        const { generateBusinessPDF } = await import('./report-generators');
        await generateBusinessPDF(assessment);
      }
    },
    downloadTechnical: async (id: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/assessments/${id}/report/technical`, { headers });
      if (!res.ok) throw new Error('Failed to download technical report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `technical-sizing-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
    downloadExcel: async (id: string, assessment?: Assessment) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = {};
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/excel`, { headers });
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `financial-model-${id}.xlsx`; a.click();
          URL.revokeObjectURL(url);
          return;
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side Excel generation
      if (assessment) {
        const { generateExcelReport } = await import('./report-generators');
        await generateExcelReport(assessment);
      }
    },
    // ── Value Assessment Engine endpoints ──
    runValueAssessment: (id: string, mode: 'full' | 'quick' = 'full', outcomeFeePercent?: number) =>
      request<{ id: string; status: string; mode: string }>(`/api/assessments/${id}/run-value-assessment`, {
        method: 'POST', body: JSON.stringify({ mode, outcomeFeePercent }),
      }),
    findings: (id: string, filters?: { category?: string; severity?: string; domain?: string }) =>
      request<{ findings: ValueAssessmentFinding[]; total: number }>(`/api/assessments/${id}/findings${qs({ category: filters?.category, severity: filters?.severity, domain: filters?.domain })}`),
    dataQuality: (id: string) =>
      request<{ dataQuality: DataQualityRecord[]; total: number }>(`/api/assessments/${id}/data-quality`),
    processTiming: (id: string) =>
      request<{ processTiming: ProcessTimingRecord[]; total: number }>(`/api/assessments/${id}/process-timing`),
    valueSummary: (id: string) =>
      request<ValueSummaryRecord>(`/api/assessments/${id}/value-summary`),
    downloadValueReport: async (id: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/assessments/${id}/report/value`, { headers });
      if (!res.ok) throw new Error('Failed to download value report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    evidence: (id: string, findingId: string) =>
      request<ValueAssessmentFinding>(`/api/assessments/${id}/evidence/${findingId}`),
  },

  // ── Admin (Superadmin only) ────────────────────────────────────────
  admin: {
    getLlmConfig: () =>
      request<LlmConfigResponse>('/api/admin/llm-config'),
    saveLlmConfig: (data: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; maxTokens?: number }) =>
      request<{ success: boolean; message: string; provider: string }>('/api/admin/llm-config', { method: 'POST', body: JSON.stringify(data) }),
  },

  // ── Apex Radar (Spec §2.1 — 11 endpoints) ───────────────────────────
  radar: {
    // Spec §4.5: signals, signalImpact, createSignal, competitors, benchmarks, regulatory, context, scan
    signals: (category?: string, limit?: number) =>
      request<{ signals: ExternalSignal[]; total: number }>(`/api/radar/signals${qs({ category, limit: limit?.toString() })}`),
    signalImpact: (id: string) =>
      request<{ signal: ExternalSignal; impacts: SignalImpact[] }>(`/api/radar/signals/${id}/impact`),
    createSignal: (data: Record<string, unknown>) =>
      request<{ id: string; message: string }>('/api/radar/signals', { method: 'POST', body: JSON.stringify(data) }),
    competitors: () =>
      request<{ competitors: Competitor[]; total: number }>('/api/radar/competitors'),
    createCompetitor: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/competitors', { method: 'POST', body: JSON.stringify(data) }),
    updateCompetitor: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/radar/competitors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCompetitor: (id: string) =>
      request<{ success: boolean }>(`/api/radar/competitors/${id}`, { method: 'DELETE' }),
    benchmarks: () =>
      request<{ benchmarks: MarketBenchmark[]; total: number }>('/api/radar/benchmarks'),
    createBenchmark: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/benchmarks', { method: 'POST', body: JSON.stringify(data) }),
    regulatory: (status?: string) =>
      request<{ events: RegulatoryEvent[]; total: number }>(`/api/radar/regulatory${qs({ status })}`),
    createRegulatory: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/regulatory', { method: 'POST', body: JSON.stringify(data) }),
    context: (tenantId?: string) =>
      request<StrategicContext>(`/api/radar/context${qs({ tenant_id: tenantId })}`),
    scan: () =>
      request<{ message: string }>('/api/radar/scan', { method: 'POST' }),
    // Legacy aliases for backwards compat with existing frontend
    getContext: (tenantId?: string) =>
      request<RadarContextResponse>(`/api/radar/context${qs({ tenant_id: tenantId })}`),
    rebuildContext: (tenantId?: string) =>
      request<{ context: RadarStrategicContext }>(`/api/radar/context/rebuild${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    getSignals: (tenantId?: string, options?: { status?: string; type?: string; limit?: number }) =>
      request<{ signals: RadarSignalItem[]; total: number }>(`/api/radar/signals${qs({ tenant_id: tenantId, status: options?.status, type: options?.type, limit: options?.limit?.toString() })}`),
    getSignal: (signalId: string, tenantId?: string) =>
      request<{ signal: RadarSignalItem; impacts: RadarSignalImpactItem[] }>(`/api/radar/signals/${signalId}${qs({ tenant_id: tenantId })}`),
    analyseSignal: (signalId: string, tenantId?: string) =>
      request<{ impacts: RadarSignalImpactItem[] }>(`/api/radar/signals/${signalId}/analyse${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    updateSignal: (signalId: string, data: { status?: string; severity?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/radar/signals/${signalId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getImpacts: (tenantId?: string, dimension?: string) =>
      request<{ impacts: RadarImpactWithSignal[]; total: number }>(`/api/radar/impacts${qs({ tenant_id: tenantId, dimension })}`),
  },

  // ── Pulse Diagnostics (Spec §2.2 — 7 endpoints) ───────────────────
  diagnostics: {
    // Spec §4.5: list, forMetric, analyse, chain, prescriptions, updatePrescription, summary
    list: (status?: string) =>
      request<{ analyses: RootCauseAnalysis[]; total: number }>(`/api/diagnostics${qs({ status })}`),
    forMetric: (metricId: string) =>
      request<{ analyses: RootCauseAnalysis[]; total: number } | { exists: false; canDiagnose: true }>(`/api/diagnostics/${metricId}`),
    analyse: (metricId: string) =>
      request<{ id: string }>(`/api/diagnostics/${metricId}/analyse`, { method: 'POST' }),
    chain: (rcaId: string) =>
      request<{ rca: Record<string, unknown>; factors: CausalFactor[] }>(`/api/diagnostics/rca/${rcaId}/chain`),
    prescriptions: (rcaId: string) =>
      request<{ prescriptions: DiagnosticPrescription[]; total: number }>(`/api/diagnostics/rca/${rcaId}/prescriptions`),
    updatePrescription: (id: string, status: string) =>
      request<{ success: boolean }>(`/api/diagnostics/prescriptions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    summary: () =>
      request<DiagnosticsSummary>('/api/diagnostics/summary'),
    // Legacy aliases for backwards compat with existing frontend
    getSummary: (tenantId?: string) =>
      request<DiagnosticSummaryResponse>(`/api/diagnostics/summary${qs({ tenant_id: tenantId })}`),
    getAnalyses: (tenantId?: string, options?: { status?: string; limit?: number }) =>
      request<{ analyses: DiagnosticAnalysisItem[]; total: number }>(`/api/diagnostics${qs({ tenant_id: tenantId, status: options?.status, limit: options?.limit?.toString() })}`),
    getAnalysis: (analysisId: string, tenantId?: string) =>
      request<DiagnosticAnalysisDetail>(`/api/diagnostics/analyses/${analysisId}${qs({ tenant_id: tenantId })}`),
    analyseMetric: (metricId: string, tenantId?: string) =>
      request<DiagnosticAnalysisDetail>(`/api/diagnostics/${metricId}/analyse${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    createFix: (data: { chain_id: string; analysis_id: string; assigned_to?: string; notes?: string }, tenantId?: string) =>
      request<{ id: string; status: string }>(`/api/diagnostics/fixes${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify(data) }),
    updateFix: (fixId: string, data: { status?: string; assigned_to?: string; outcome?: string; notes?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/diagnostics/fixes/${fixId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getFixes: (tenantId?: string, status?: string) =>
      request<{ fixes: DiagnosticFixItem[]; total: number }>(`/api/diagnostics/fixes${qs({ tenant_id: tenantId, status })}`),
  },

  // ── Catalyst Intelligence (Spec §2.3 — 7 endpoints) ────────────────
  catalystIntelligence: {
    // Spec §4.5: patterns, patternDetail, analyse, effectiveness, dependencies, prescriptions, updatePrescription
    patterns: (clusterId?: string, type?: string) =>
      request<{ patterns: CatalystPattern[]; total: number }>(`/api/catalyst-intelligence/patterns${qs({ cluster_id: clusterId, type })}`),
    patternDetail: (id: string) =>
      request<{ pattern: CatalystPattern; prescription: CatalystPrescriptionItem | null }>(`/api/catalyst-intelligence/patterns/${id}`),
    analyse: (clusterId?: string, subName?: string) =>
      request<{ message: string }>('/api/catalyst-intelligence/analyse', { method: 'POST', body: JSON.stringify({ cluster_id: clusterId, sub_catalyst_name: subName }) }),
    effectiveness: (clusterId?: string, period?: string) =>
      request<{ effectiveness: CatalystEffectivenessData[]; total: number }>(`/api/catalyst-intelligence/effectiveness${qs({ cluster_id: clusterId, period })}`),
    dependencies: () =>
      request<{ dependencies: CatalystDependency[]; total: number }>('/api/catalyst-intelligence/dependencies'),
    prescriptions: (status?: string, clusterId?: string) =>
      request<{ prescriptions: CatalystPrescriptionItem[]; total: number }>(`/api/catalyst-intelligence/prescriptions${qs({ status, cluster_id: clusterId })}`),
    updatePrescription: (id: string, status: string) =>
      request<{ success: boolean }>(`/api/catalyst-intelligence/prescriptions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    // Legacy aliases for backwards compat with existing frontend
    getPatterns: (tenantId?: string, options?: { status?: string; type?: string; limit?: number }) =>
      request<{ patterns: CatalystPatternItem[]; total: number }>(`/api/catalyst-intelligence/patterns${qs({ tenant_id: tenantId, status: options?.status, type: options?.type, limit: options?.limit?.toString() })}`),
    updatePattern: (patternId: string, data: { status?: string; severity?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/catalyst-intelligence/patterns/${patternId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getEffectiveness: (tenantId?: string, clusterId?: string) =>
      request<{ effectiveness: CatalystEffectivenessItem[]; total: number }>(`/api/catalyst-intelligence/effectiveness${qs({ tenant_id: tenantId, cluster_id: clusterId })}`),
    calculateEffectiveness: (tenantId?: string, periodDays?: number) =>
      request<{ effectiveness: CatalystEffectivenessItem[]; total: number; periodDays: number }>(`/api/catalyst-intelligence/effectiveness/calculate${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify({ period_days: periodDays || 30 }) }),
    getDependencies: (tenantId?: string, clusterId?: string) =>
      request<{ dependencies: CatalystDependencyItem[]; total: number }>(`/api/catalyst-intelligence/dependencies${qs({ tenant_id: tenantId, cluster_id: clusterId })}`),
    discoverDependencies: (tenantId?: string) =>
      request<{ dependencies: CatalystDependencyItem[]; discovered: number }>(`/api/catalyst-intelligence/dependencies/discover${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    getOverview: (tenantId?: string) =>
      request<CatalystIntelligenceOverview>(`/api/catalyst-intelligence/overview${qs({ tenant_id: tenantId })}`),
    getPrescriptions: (tenantId?: string, status?: string) =>
      request<{ prescriptions: CatalystPrescriptionItem[]; total: number }>(`/api/catalyst-intelligence/prescriptions${qs({ tenant_id: tenantId, status })}`),
  },

  // ── ROI Tracking (Spec §2.4 — 3 endpoints) ─────────────────────────
  roi: {
    summary: () =>
      request<ROISummary>('/api/roi'),
    history: (limit?: number) =>
      request<{ history: ROISummary[]; total: number }>(`/api/roi/history${qs({ limit: limit?.toString() })}`),
    exportPdf: async () => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/roi/export`, { headers });
      if (!res.ok) throw new Error('Failed to export ROI PDF');
      return res.blob();
    },
    // Legacy aliases for backwards compat
    get: (tenantId?: string) =>
      request<ROITrackingResponse>(`/api/roi${qs({ tenant_id: tenantId })}`),
    exportCsv: (tenantId?: string) =>
      request<{ export: Record<string, unknown>[]; total: number; currency: string }>(`/api/roi/export${qs({ tenant_id: tenantId })}`),
  },

  // ── Board Report (Spec §2.5 — 3 endpoints) ─────────────────────────
  boardReport: {
    generate: (tenantId?: string) =>
      request<BoardReportItem>(`/api/board-report/generate${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    list: (tenantId?: string) =>
      request<{ reports: BoardReportItem[]; total: number }>(`/api/board-report${qs({ tenant_id: tenantId })}`),
    get: (id: string, tenantId?: string) =>
      request<BoardReportItem>(`/api/board-report/${id}${qs({ tenant_id: tenantId })}`),
    /** @deprecated Use generate/list/get instead */
    generateV2: (tenantId?: string) =>
      request<BoardReport>(`/api/board-report/generate${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    listV2: (tenantId?: string) =>
      request<{ reports: BoardReport[]; total: number }>(`/api/board-report${qs({ tenant_id: tenantId })}`),
    getV2: (id: string, tenantId?: string) =>
      request<BoardReport>(`/api/board-report/${id}${qs({ tenant_id: tenantId })}`),
    downloadPdf: async (id: string, title?: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/board-report/${id}/pdf`, { headers });
      if (!res.ok) throw new Error('Failed to download board report PDF');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeName = (title || 'board-report').replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
  },

  // ── Onboarding (Spec §9.2) ─────────────────────────────────
  onboarding: {
    progress: () =>
      request<OnboardingProgressResponse>('/api/onboarding/progress'),
    completeStep: (stepId: string) =>
      request<{ success: boolean; stepId: string }>(`/api/onboarding/complete/${stepId}`, { method: 'PUT' }),
    dismiss: () =>
      request<{ success: boolean; message: string }>('/api/onboarding/dismiss', { method: 'PUT' }),
  },

  // ── Freshness (Spec §9.3) ──────────────────────────────────
  freshness: {
    get: () =>
      request<FreshnessResponse>('/api/freshness'),
  },

  // ── §11.7 Atheon Score ─────────────────────────────────────
  atheonScore: {
    get: () =>
      request<AtheonScoreResponse>('/api/atheon-score'),
  },

  // ── §11.1 Trial Assessment (public — no auth) ─────────────
  trial: {
    start: (data: { company_name: string; industry: string; contact_name: string; contact_email: string }) =>
      request<{ id: string; tenantId: string; status: string }>('/api/trial/start', { method: 'POST', body: JSON.stringify(data) }),
    upload: (id: string, data: { filename: string; row_count: number; columns: string[] }) =>
      request<{ received: boolean }>(`/api/trial/${id}/upload`, { method: 'POST', body: JSON.stringify(data) }),
    run: (id: string) =>
      request<{ status: string }>(`/api/trial/${id}/run`, { method: 'POST' }),
    status: (id: string) =>
      request<{ id: string; status: string; progress: number; currentStep: string | null }>(`/api/trial/${id}/status`),
    results: (id: string) =>
      request<TrialResultsResponse>(`/api/trial/${id}/results`),
    report: (id: string) =>
      request<TrialReportResponse>(`/api/trial/${id}/report`),
  },

  // ── §11.2 Baseline Snapshots ──────────────────────────────
  baseline: {
    capture: (snapshotType?: string) =>
      request<{ id: string; snapshotType: string; healthScore: number }>('/api/baseline/capture', { method: 'POST', body: JSON.stringify({ snapshot_type: snapshotType || 'manual' }) }),
    list: () =>
      request<{ snapshots: BaselineSnapshot[]; total: number }>('/api/baseline'),
    comparison: () =>
      request<BaselineComparisonResponse>('/api/baseline/comparison'),
  },

  // ── §11.3 Goal Setting & Target Tracking ──────────────────
  targets: {
    list: () =>
      request<{ targets: HealthTarget[]; total: number }>('/api/targets'),
    create: (data: { target_type: string; target_name: string; target_value: number; target_deadline?: string }) =>
      request<{ id: string }>('/api/targets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/targets/${id}`, { method: 'DELETE' }),
  },

  // ── §11.4 Peer Benchmarks ─────────────────────────────────
  peerBenchmarks: {
    get: () =>
      request<PeerBenchmarksResponse>('/api/radar/peer-benchmarks'),
  },

  // ── §11.5 Cost of Inaction ────────────────────────────────
  costOfInaction: {
    get: () =>
      request<CostOfInactionResponse>('/api/diagnostics/cost-of-inaction'),
  },

  // ── §11.6 Success Stories ─────────────────────────────────
  successStories: {
    get: () =>
      request<SuccessStoriesResponse>('/api/radar/success-stories'),
  },

  // ── §11.8 Executive Summary ───────────────────────────────
  executiveSummary: {
    get: () =>
      request<ExecutiveSummaryResponse>('/api/executive-summary'),
  },

  // ── Admin Tooling (ADMIN-001 to ADMIN-012) ─────────────────
  adminTooling: {
    // ADMIN-001: Platform Health
    platformHealth: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/platform-health'),
    // ADMIN-002: Support Console
    supportTenants: (q?: string) =>
      request<{ tenants: Record<string, unknown>[] }>(`/api/v1/admin-tooling/support/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    supportTenantDetail: (id: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/support/tenant/${id}`),
    // ADMIN-003: Company Health
    companyHealth: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/company-health'),
    // ADMIN-004: Impersonation
    impersonateSearch: (q?: string) =>
      request<{ users: Record<string, unknown>[] }>(`/api/v1/admin-tooling/impersonate/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    impersonateStart: (userId: string) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/impersonate/start', { method: 'POST', body: JSON.stringify({ userId }) }),
    impersonateEnd: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/impersonate/end', { method: 'POST' }),
    // ADMIN-005: Bulk Users
    bulkUsersExport: (tenantId?: string) =>
      request<{ users: Record<string, unknown>[]; count: number }>(`/api/v1/admin-tooling/bulk-users/export${tenantId ? `?tenantId=${tenantId}` : ''}`),
    bulkUsersImport: (users: Array<{ name: string; email: string; role: string; department?: string }>) =>
      request<{ imported: number; skipped: number }>('/api/v1/admin-tooling/bulk-users/import', { method: 'POST', body: JSON.stringify({ users }) }),
    bulkUsersAction: (userIds: string[], action: string, value?: string) =>
      request<{ affected: number }>('/api/v1/admin-tooling/bulk-users/action', { method: 'POST', body: JSON.stringify({ userIds, action, value }) }),
    // ADMIN-006: Custom Roles
    customRolesList: () =>
      request<{ roles: Record<string, unknown>[]; count: number }>('/api/v1/admin-tooling/custom-roles'),
    customRolesCreate: (data: { name: string; description: string; permissions: string[] }) =>
      request<{ id: string }>('/api/v1/admin-tooling/custom-roles', { method: 'POST', body: JSON.stringify(data) }),
    customRolesDelete: (id: string) =>
      request<{ success: boolean }>(`/api/v1/admin-tooling/custom-roles/${id}`, { method: 'DELETE' }),
    // ADMIN-007: Revenue
    revenue: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/revenue'),
    // ADMIN-008: Feature Flags
    featureFlags: () =>
      request<{ flags: Record<string, unknown>[] }>('/api/v1/admin-tooling/feature-flags'),
    featureFlagCreate: (flag: { key: string; name: string; type: string; enabled: boolean; value?: unknown }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/feature-flags', { method: 'POST', body: JSON.stringify(flag) }),
    featureFlagUpdate: (key: string, update: { enabled?: boolean; value?: unknown }) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/feature-flags/${key}`, { method: 'PUT', body: JSON.stringify(update) }),
    featureFlagDelete: (key: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/feature-flags/${key}`, { method: 'DELETE' }),
    // ADMIN-009: Data Governance
    dataGovernance: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/data-governance'),
    dsarCreate: (data: { type: string; subjectEmail: string; notes?: string }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/data-governance/dsar', { method: 'POST', body: JSON.stringify(data) }),
    // ADMIN-010: Integration Health
    integrationHealth: () =>
      request<{ connections: Record<string, unknown>[] }>('/api/v1/admin-tooling/integration-health'),
    // ADMIN-011: Tenant Read Access
    tenantsRead: () =>
      request<{ tenants: Record<string, unknown>[]; count: number }>('/api/v1/admin-tooling/tenants-read'),
    tenantReadDetail: (id: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/tenants-read/${id}`),
    // ADMIN-012: System Alerts
    systemAlerts: () =>
      request<{ alerts: Record<string, unknown>[] }>('/api/v1/admin-tooling/system-alerts'),
    alertRules: () =>
      request<{ rules: Record<string, unknown>[] }>('/api/v1/admin-tooling/system-alerts/rules'),
    alertRuleCreate: (rule: { name: string; condition: string; severity: string; channels: string[] }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/system-alerts/rules', { method: 'POST', body: JSON.stringify(rule) }),
    alertRuleUpdate: (id: string, update: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/system-alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(update) }),
  },

  // Generic HTTP helpers for pages that call arbitrary endpoints
  get: <T = Record<string, unknown>>(path: string) => request<T>(path),
  post: <T = Record<string, unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  put: <T = Record<string, unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  delete: <T = Record<string, unknown>>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Types for API responses
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  permissions: string[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry: string;
  plan: string;
  status: string;
  deploymentModel: string;
  region: string;
  createdAt: string;
  entitlements: TenantEntitlements;
}

export interface TenantEntitlements {
  layers: string[];
  catalystClusters: string[];
  maxAgents: number;
  maxUsers: number;
  autonomyTiers: string[];
  llmTiers: string[];
  features: string[];
  ssoEnabled: boolean;
  apiAccess: boolean;
  customBranding: boolean;
  dataRetentionDays: number;
}

export interface TenantDetail extends Tenant {
  updatedAt: string;
  stats: { users: number; agents: number; clusters: number };
}

export interface IAMPolicy {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: string;
  rules: Record<string, unknown>[];
  createdAt: string;
}

export interface IAMRole {
  id: string;
  name: string;
  description: string;
  level: number;
  userCount: number;
}

export interface IAMUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  status: string;
  lastLogin: string | null;
  createdAt: string;
}

export interface SSOConfig {
  id: string;
  provider: string;
  clientId: string;
  issuerUrl: string;
  enabled: boolean;
  autoProvision: boolean;
  defaultRole: string;
  domainHint: string;
}

export interface HealthScore {
  id: string;
  overall: number;
  dimensions: Record<string, { score: number; trend: string; delta?: number }>;
  calculatedAt: string;
}

export interface Briefing {
  id: string;
  title: string;
  summary: string;
  risks: string[];
  opportunities: string[];
  kpiMovements: { kpi: string; movement: string; period: string }[];
  decisionsNeeded: string[];
  generatedAt: string;
  // A2: Data-driven briefing fields
  healthDelta: number | null;
  redMetricCount: number | null;
  anomalyCount: number | null;
  activeRiskCount: number | null;
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  probability: number;
  impactValue: number;
  impactUnit: string;
  recommendedActions: string[];
  status: string;
  detectedAt: string;
  // A4-3: Source attribution for drill-through
  sourceRunId: string | null;
  clusterId: string | null;
  subCatalystName: string | null;
}

export interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  inputQuery: string;
  variables: string[];
  results: Record<string, unknown>;
  context?: Record<string, unknown>;
  status: string;
  createdAt: string;
}

// A1-4: Health dimension traceability response
export interface HealthDimensionTraceResponse {
  dimension: string;
  score: number | null;
  trend: string;
  delta: number;
  contributors: string[];
  sourceRunId: string | null;
  catalystName: string | null;
  kpiContributors: Array<{ name: string; value: number; status: string }>;
  lastUpdated: string;
  calculatedAt: string;
  traceability: {
    contributingClusters: Array<{ clusterId: string; clusterName: string; domain: string; subCataulysts: Array<{ name?: string }> }>;
    recentRuns: Array<{ runId: string; clusterId: string; subCataulystName: string; status: string; matched: number; discrepancies: number; exceptions: number; totalValue: number; startedAt: string }>;
    relevantKpis: Array<{ kpiId: string; kpiName: string; category: string; value: number; status: string; unit: string; measuredAt: string; subCataulystName: string; runId: string }>;
  };
  drillDownPath: {
    dimension: string;
    clusters: string[];
    subCataulysts: string[];
    runs: string[];
    items: string;
  };
}

// A4-4: Risk alert traceability response
export interface RiskTraceResponse {
  riskAlert: {
    id: string;
    title: string;
    description: string;
    severity: string;
    category: string;
    probability: number;
    impactValue: number;
    impactUnit: string;
    recommendedActions: string[];
    status: string;
    detectedAt: string;
    resolvedAt: string | null;
  };
  sourceAttribution: {
    sourceRunId: string | null;
    clusterId: string | null;
    subCataulystName: string | null;
  };
  sourceRun: {
    runId: string;
    clusterId: string;
    subCataulystName: string;
    catalystName: string;
    status: string;
    matched: number;
    discrepancies: number;
    exceptions: number;
    totalValue: number;
    startedAt: string;
    completedAt: string;
    reasoning: string | null;
  } | null;
  cluster: {
    clusterId: string;
    clusterName: string;
    domain: string;
    autonomyTier: string;
    subCataulysts: Array<{ name?: string }>;
  } | null;
  contributingKpis: Array<{ kpiName: string; category: string; unit: string; value: number; status: string; measuredAt: string }>;
  flaggedItems: Array<{ itemNumber: number; status: string; type: string | null; severity: string | null; sourceRef: string | null; targetRef: string | null; field: string | null; sourceValue: unknown; targetValue: unknown; difference: string | null }>;
  relatedAnomalies: Array<{ anomalyId: string; metric: string; severity: string; expectedValue: number; actualValue: number; deviation: number; detectedAt: string }>;
  drillDownPath: {
    risk: string;
    run: string | null;
    items: string;
    cluster: string | null;
    kpis: string;
  };
}

// P1-4: Metric traceability response
export interface MetricTraceResponse {
  metric: {
    id: string;
    name: string;
    value: number;
    status: string;
    unit: string;
    measuredAt: string;
    trend: number[];
  };
  sourceAttribution: {
    subCataulystName: string | null;
    sourceRunId: string | null;
    clusterId: string | null;
    sourceSystem: string | null;
  };
  sourceRun: {
    runId: string;
    subCataulystName: string;
    status: string;
    matched: number;
    discrepancies: number;
    exceptions: number;
    totalValue: number;
    startedAt: string;
    completedAt: string;
  } | null;
  cluster: {
    clusterId: string;
    clusterName: string;
    domain: string;
    subCataulysts: Array<{ name?: string }>;
  } | null;
  contributingKpis: Array<{ kpiName: string; category: string; value: number; status: string; measuredAt: string }>;
  relatedAnomalies: Array<{ anomalyId: string; severity: string; expectedValue: number; actualValue: number; deviation: number; detectedAt: string }>;
  drillDownPath: {
    metric: string;
    run: string | null;
    items: string;
    kpis: string;
  };
}

// A1-3: Health score history
export interface HealthHistoryItem {
  id: string;
  overallScore: number;
  dimensions: Record<string, unknown>;
  sourceRunId: string | null;
  catalystName: string | null;
  recordedAt: string;
}
export interface HealthHistoryResponse {
  history: HealthHistoryItem[];
  delta: number;
  deltaLabel: string;
  total: number;
}

export interface Metric {
  id: string;
  name: string;
  value: number;
  unit: string;
  status: string;
  thresholds: { green: number | null; amber: number | null; red: number | null };
  trend: number[];
  sourceSystem: string | null;
  measuredAt: string;
  // P1-3: Source attribution
  subCatalystName: string | null;
  sourceRunId: string | null;
  clusterId: string | null;
}

export interface AnomalyItem {
  id: string;
  metric: string;
  severity: string;
  expectedValue: number;
  actualValue: number;
  deviation: number;
  hypothesis: string;
  status: string;
  detectedAt: string;
}

export interface ProcessItem {
  id: string;
  name: string;
  steps: { id: string; name: string; avgDuration: number; throughput: number; status: string }[];
  variants: number;
  avgDuration: number;
  conformanceRate: number;
  bottlenecks: string[];
}

export interface CorrelationItem {
  id: string;
  metricA: string;
  metricB: string;
  sourceSystem: string;
  sourceEvent: string;
  targetSystem: string;
  targetImpact: string;
  correlationType: string;
  confidence: number;
  lagHours: number;
  lagDays: number;
  description: string;
  detectedAt: string;
  sourceRunId: string | null;
  clusterId: string | null;
}

export interface PulseSummary {
  totalMetrics: number;
  statusBreakdown: { green: number; amber: number; red: number };
  openAnomalies: number;
}

export interface CatalystRunItem {
  id: string;
  clusterId: string;
  catalystName: string;
  action: string;
  status: string;
  confidence: number;
  inputData: Record<string, unknown> | null;
  outputData: Record<string, unknown> | null;
  reasoning: string | null;
  approvedBy: string | null;
  assignedTo?: { validators?: string[]; exceptionHandlers?: string[]; escalation?: string[] } | null;
  createdAt: string;
  completedAt: string | null;
  needsHumanReview: boolean;
}

export interface CatalystRunSummary {
  catalystName: string;
  totalRuns: number;
  completed: number;
  exceptions: number;
  pending: number;
  avgConfidence: number;
  successRate: number;
}

export type DataSourceType = 'erp' | 'email' | 'cloud_storage' | 'upload' | 'custom_system';

export interface DataSourceConfig {
  type: DataSourceType;
  config: Record<string, unknown>;
}

export interface CatalystSubCatalystTemplate {
  name: string;
  enabled: boolean;
  description: string;
  schedule?: SubCatalystSchedule;
}

export interface CatalystClusterTemplate {
  name: string;
  domain: string;
  description: string;
  autonomy_tier: string;
  subCatalystCount: number;
  sub_catalysts: CatalystSubCatalystTemplate[];
}

export interface CatalystIndustryTemplate {
  industry: string;
  label: string;
  description: string;
  clusterCount: number;
  clusters: CatalystClusterTemplate[];
}

export interface SubCatalystSchedule {
  frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
  day_of_week?: number;   // 0=Sun..6=Sat (for weekly)
  day_of_month?: number;  // 1-31 (for monthly)
  time_of_day?: string;   // HH:MM in UTC
  last_run?: string;      // ISO datetime of last scheduled run
  next_run?: string;      // ISO datetime of next scheduled run
}

export interface FieldMapping {
  id: string;
  source_index: number;       // index into data_sources array
  target_index: number;       // index into data_sources array
  source_field: string;       // field name in source system
  target_field: string;       // field name in target system
  match_type: 'exact' | 'fuzzy' | 'contains' | 'numeric_tolerance' | 'date_range';
  tolerance?: number;         // for numeric_tolerance (e.g. 0.01 = 1 cent)
  confidence: number;         // 0-1 confidence that this mapping is correct
  auto_suggested: boolean;    // was this suggested by the smart matcher?
}

export interface ExecutionConfig {
  mode: 'reconciliation' | 'validation' | 'sync' | 'extract' | 'compare';
  parameters?: Record<string, unknown>;
}

export interface ExecutionResult {
  id: string;
  sub_catalyst: string;
  cluster_id: string;
  executed_at: string;
  duration_ms: number;
  status: 'completed' | 'failed' | 'partial';
  mode: string;
  summary: {
    total_records_source: number;
    total_records_target: number;
    matched: number;
    unmatched_source: number;
    unmatched_target: number;
    discrepancies: number;
  };
  discrepancies?: Array<{
    source_record: Record<string, unknown>;
    target_record: Record<string, unknown> | null;
    field: string;
    source_value: unknown;
    target_value: unknown;
    difference?: string;
  }>;
  error?: string;
}

export interface SubCatalyst {
  name: string;
  enabled: boolean;
  description?: string;
  data_source?: DataSourceConfig;
  data_sources?: DataSourceConfig[];
  field_mappings?: FieldMapping[];
  execution_config?: ExecutionConfig;
  last_execution?: ExecutionResult;
  schedule?: SubCatalystSchedule;
}

export interface ClusterItem {
  id: string;
  name: string;
  domain: string;
  description: string;
  status: string;
  agentCount: number;
  tasksCompleted: number;
  tasksInProgress: number;
  successRate: number;
  trustScore: number;
  autonomyTier: string;
  subCatalysts: SubCatalyst[];
  createdAt: string;
}

export interface ClusterDetail extends ClusterItem {
  recentActions: ActionItem[];
  deployments: DeploymentItem[];
}

export interface ActionItem {
  id: string;
  clusterId?: string;
  catalystName: string;
  action: string;
  status: string;
  confidence: number;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  reasoning: string | null;
  approvedBy?: string;
  createdAt: string;
  completedAt?: string;
}

export interface GovernanceData {
  totalActions: number;
  pendingApprovals: number;
  approved: number;
  rejected: number;
  clusterAutonomy: { domain: string; autonomyTier: string; trustScore: number }[];
}

export interface HitlConfig {
  id: string;
  tenantId: string;
  clusterId: string;
  subCatalystName?: string | null;
  domain: string;
  validatorUserIds: string[];
  exceptionHandlerUserIds: string[];
  escalationUserIds: string[];
  notifyOnCompletion: boolean;
  notifyOnException: boolean;
  notifyOnApprovalNeeded: boolean;
  createdAt: string;
  updatedAt: string;
  users: Record<string, { email: string; name: string }>;
}

export interface HitlConfigListItem {
  id: string;
  tenantId: string;
  clusterId: string;
  subCatalystName?: string | null;
  clusterName: string;
  domain: string;
  validatorUserIds: string[];
  exceptionHandlerUserIds: string[];
  escalationUserIds: string[];
  notifyOnCompletion: boolean;
  notifyOnException: boolean;
  notifyOnApprovalNeeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunAnalytics {
  id: string;
  runId: string;
  clusterId: string;
  clusterName?: string;
  subCatalystName?: string | null;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: string;
  summary: {
    total: number;
    completed: number;
    exceptions: number;
    escalated: number;
    pending: number;
    autoApproved: number;
  };
  confidence: {
    avg: number;
    min: number;
    max: number;
    distribution: Record<string, number>;
  };
  insights: string[];
}

export interface RunAnalyticsAggregate {
  totalRuns: number;
  totalItems: number;
  totalCompleted: number;
  totalExceptions: number;
  totalEscalated: number;
  avgConfidence: number;
  automationRate: number;
}

export interface GraphEntity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  source: string;
  validFrom?: string;
  validTo?: string;
}

export interface GraphEntityDetail extends GraphEntity {
  relationships: {
    outgoing: { id: string; type: string; targetId: string; targetName: string; targetType: string; properties: Record<string, unknown>; confidence: number }[];
    incoming: { id: string; type: string; sourceId: string; sourceName: string; sourceType: string; properties: Record<string, unknown>; confidence: number }[];
  };
}

export interface GraphRelationship {
  id: string;
  type: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  properties: Record<string, unknown>;
  confidence: number;
}

export interface GraphData {
  nodes: { id: string; type: string; name: string; properties: Record<string, unknown>; confidence: number }[];
  edges: { id: string; source: string; target: string; type: string; confidence: number }[];
}

export interface GraphQueryResult {
  query: string;
  directMatches: GraphEntity[];
  relatedEntities: GraphEntity[];
  context: string;
  answer: string;
}

export interface GraphStats {
  entities: number;
  relationships: number;
  entityTypes: { type: string; count: number }[];
  relationshipTypes: { type: string; count: number }[];
}

export interface MindQueryResult {
  id: string;
  response: string;
  tier: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  citations: string[];
  generatedAt: string;
}

export interface MindModels {
  tiers: { id: string; name: string; model: string; maxTokens: number; avgLatency?: number; description: string }[];
  industryAdapters: { id: string; name: string; metrics: string[]; status: string }[];
  trainingPipeline: {
    preTraining: { status: string; progress: number; dataset: string };
    domainFineTuning: { status: string; progress: number; currentEpoch: number; totalEpochs: number };
    rlhf: { status: string; progress: number };
    evaluation: { mmlu: number; humaneval: number; domainAccuracy: number; hallucination_rate: number };
  };
}

export interface MindHistoryItem {
  id: string;
  query: string;
  response: string;
  tier: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  citations: string[];
  createdAt: string;
}

export interface MindStats {
  totalQueries: number;
  avgLatencyMs: number;
  totalTokens: number;
  tierBreakdown: { tier: string; count: number; avg_latency: number }[];
}

export interface ERPAdapter {
  id: string;
  name: string;
  system: string;
  version: string;
  protocol: string;
  status: string;
  operations: string[];
  authMethods: string[];
}

export interface ERPAdapterDetail extends ERPAdapter {
  connections: { id: string; tenantId: string; tenantName: string; name: string; status: string; lastSync: string | null; recordsSynced: number }[];
}

export interface ERPConnection {
  id: string;
  adapterId: string;
  adapterName: string;
  adapterSystem: string;
  adapterProtocol: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  lastSync: string | null;
  syncFrequency: string;
  recordsSynced: number;
  connectedAt: string | null;
}

export interface CanonicalEndpoint {
  id: string;
  domain: string;
  path: string;
  method: string;
  description: string;
  rateLimit: number;
  version: string;
}

export interface DeploymentItem {
  id: string;
  tenantId: string;
  tenantName: string;
  clusterId: string | null;
  clusterName: string | null;
  clusterDomain: string | null;
  name: string;
  agentType: string;
  status: string;
  deploymentModel: string;
  version: string;
  healthScore: number;
  uptime: number;
  tasksExecuted: number;
  lastHeartbeat: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface ControlPlaneHealth {
  overallHealth: number;
  overallUptime: number;
  deploymentStatus: Record<string, number>;
  lastChecked: string;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  layer: string;
  resource: string | null;
  details: Record<string, unknown> | null;
  outcome: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditStats {
  totalEntries: number;
  layerBreakdown: { layer: string; count: number }[];
  outcomeBreakdown: { outcome: string; count: number }[];
  recentActivity: { action: string; layer: string; outcome: string; created_at: string }[];
}

export interface ManualExecuteResult {
  actionId: string;
  status: string;
  message: string;
  startDatetime: string;
  endDatetime: string;
  fileName: string | null;
}

export interface ExecutionLogEntry {
  id: string;
  actionId: string;
  stepNumber: number;
  stepName: string;
  status: string;
  detail: string;
  durationMs: number | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

// ── Hybrid Deployment Types ─────────────────────────────────────────────
export interface ManagedDeployment {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug?: string;
  name: string;
  deploymentType: 'hybrid' | 'on-premise';
  status: 'pending' | 'provisioning' | 'active' | 'degraded' | 'offline' | 'suspended';
  licenceKey: string;
  licenceExpiresAt: string | null;
  agentVersion: string | null;
  apiVersion: string | null;
  customerApiUrl: string | null;
  region: string;
  lastHeartbeat: string | null;
  healthScore: number;
  config: Record<string, unknown>;
  resourceUsage: { cpuPct?: number; memMb?: number; diskGb?: number; activeUsers?: number };
  errorLog?: AgentErrorLog[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentRequest {
  tenant_id: string;
  name: string;
  deployment_type?: 'hybrid' | 'on-premise';
  region?: string;
  licence_expires_at?: string;
  config?: Record<string, unknown>;
}

export interface CreateDeploymentResponse {
  id: string;
  licenceKey: string;
  status: string;
  installConfig: {
    deploymentId: string;
    licenceKey: string;
    controlPlaneUrl: string;
    heartbeatIntervalSeconds: number;
    agentImage: string;
    initialConfig: Record<string, unknown>;
    envFile: string;
    installCommand: string;
  };
  message: string;
}

export interface AgentErrorLog {
  ts: string;
  message: string;
  code?: string;
  severity: string;
}

// ── Assessment Types ────────────────────────────────────────────────────
export interface Assessment {
  id: string;
  tenantId: string;
  tenantName?: string;
  prospectName: string;
  prospectIndustry: string;
  erpConnectionId: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  config: Record<string, unknown>;
  dataSnapshot: Record<string, unknown>;
  results: AssessmentResults;
  businessReportKey: string | null;
  technicalReportKey: string | null;
  excelModelKey: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AssessmentResults {
  catalyst_scores?: CatalystScore[];
  technical_sizing?: TechnicalSizing;
  volume_snapshot?: Record<string, unknown>;
  narrative?: string;
  error?: string;
}

export interface CatalystScore {
  catalyst_name: string;
  domain: string;
  priority: number;
  deploy_order: number;
  estimated_annual_saving_zar: number;
  saving_components: { label: string; amount_zar: number; methodology: string }[];
  data_insights: string[];
  confidence: 'high' | 'medium' | 'low';
  sub_catalysts: SubCatalystScore[];
  estimated_monthly_api_calls: number;
  estimated_monthly_vector_queries: number;
  estimated_monthly_llm_tokens: number;
  estimated_db_size_mb: number;
}

export interface SubCatalystScore {
  name: string;
  recommended: boolean;
  priority_within_cluster: number;
  estimated_monthly_volume: number;
  volume_unit: string;
  estimated_monthly_api_calls: number;
  estimated_monthly_llm_tokens: number;
  estimated_annual_saving_zar: number;
  deploy_prerequisite?: string;
}

// ── Sub-Catalyst Ops Types ──

export interface SubCatalystRun {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  run_number: number;
  triggered_by: string;
  trigger_context?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: string;
  mode: string;
  matched: number;
  unmatched_source: number;
  unmatched_target: number;
  discrepancies: number;
  exceptions_raised: number;
  avg_confidence: number;
  total_source_value: number;
  total_matched_value: number;
  total_discrepancy_value: number;
  total_exception_value: number;
  total_unmatched_value: number;
  currency: string;
  items_total: number;
  items_reviewed: number;
  items_approved: number;
  items_rejected: number;
  items_deferred: number;
  review_complete: boolean;
  sign_off_status: string;
  signed_off_by?: string;
  signed_off_at?: string;
  sign_off_notes?: string;
  reasoning?: string;
  recommendations?: string;
  source_record_count: number;
  target_record_count: number;
  parent_run_id?: string;
}

export interface SubCatalystRunDetail {
  run: SubCatalystRun;
  steps: Array<{ step: number; name: string; status: string; duration_ms: number; detail: string }>;
  linkedOutputs: { metrics: string[]; anomalies: string[]; risk_alerts: string[]; actions: string[] };
}

export interface SubCatalystKpis {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_records_processed: number;
  avg_match_rate: number;
  avg_discrepancy_rate: number;
  avg_confidence: number;
  total_exceptions: number;
  exception_rate: number;
  success_trend: string;
  duration_trend: string;
  discrepancy_trend: string;
  confidence_trend: string;
  status: string;
  last_run_at?: string;
  threshold_success_green: number;
  threshold_success_amber: number;
  threshold_success_red: number;
  threshold_duration_green: number;
  threshold_duration_amber: number;
  threshold_duration_red: number;
  threshold_discrepancy_green: number;
  threshold_discrepancy_amber: number;
  threshold_discrepancy_red: number;
}

export interface KpiDefinitionItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  direction: string;
  value: number | null;
  status: string;
  thresholds: { green: number | null; amber: number | null; red: number | null };
  trend: number[];
  is_universal: boolean;
  enabled: boolean;
  sort_order: number;
  calculation: string;
  data_source: string;
}

export interface KpiDefinitionRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  kpi_name: string;
  unit: string;
  direction: string;
  threshold_green: number | null;
  threshold_amber: number | null;
  threshold_red: number | null;
  calculation: string;
  data_source: string;
  category: string;
  is_universal: number;
  sort_order: number;
  enabled: number;
}

export interface KpisResponse {
  overall_status: string;
  aggregate: SubCatalystKpis | null;
  definitions: KpiDefinitionItem[];
}

export interface SubCatalystRunItem {
  id: string;
  run_id: string;
  item_number: number;
  item_status: string;
  category?: string;
  source_ref?: string;
  source_date?: string;
  source_entity?: string;
  source_amount?: number;
  source_currency?: string;
  target_ref?: string;
  target_date?: string;
  target_entity?: string;
  target_amount?: number;
  target_currency?: string;
  match_confidence?: number;
  match_method?: string;
  discrepancy_field?: string;
  discrepancy_source_value?: string;
  discrepancy_target_value?: string;
  discrepancy_amount?: number;
  discrepancy_pct?: number;
  discrepancy_reason?: string;
  exception_type?: string;
  exception_severity?: string;
  exception_detail?: string;
  review_status: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  reclassified_to?: string;
}

export interface SubCatalystRunItemsResponse {
  items: SubCatalystRunItem[];
  totals: {
    items_total: number;
    matched: number;
    discrepancies: number;
    unmatched: number;
    exceptions: number;
    total_source_value: number;
    total_matched_value: number;
    total_discrepancy_value: number;
    total_exception_value: number;
  };
  review_progress: {
    reviewed: number;
    approved: number;
    rejected: number;
    deferred: number;
    pending: number;
  };
  total: number;
}

export interface SubCatalystRunComparison {
  run_a: SubCatalystRun | null;
  run_b: SubCatalystRun | null;
  delta: Record<string, number>;
  new_discrepancies: Record<string, unknown>[];
  resolved_discrepancies: Record<string, unknown>[];
  persistent_discrepancies: Record<string, unknown>[];
}

export interface RunComment {
  id: string;
  tenant_id: string;
  run_id: string;
  item_id?: string;
  user_id: string;
  user_name: string;
  comment: string;
  comment_type: string;
  created_at: string;
}

// Insights Engine response types
export interface InsightDriver {
  type: string;
  source: string;
  metric?: string;
  value?: number;
  runId?: string;
  subCatalyst?: string;
  domain?: string;
  description?: string;
}

export interface PulseInsightsResponse {
  insights: string;
  recommendations: string[];
  drivers: InsightDriver[];
  domain: string;
  generatedAt: string;
  poweredBy: string;
}

export interface ApexInsightsResponse {
  executiveSummary: string;
  performanceDrivers: Array<{ dimension: string; driver: string; impact: string; trend: string }>;
  issues: Array<{ title: string; severity: string; description: string; affectedDomain: string; traceability?: Record<string, unknown> }>;
  crossDepartmentCorrelations: string[];
  strategicImplications: string[];
  generatedAt: string;
  poweredBy: string;
}

export interface DashboardIntelligenceResponse {
  summary: string;
  keyMetrics: Array<{ name: string; value: number; trend: string; status: string; impact?: string }>;
  topRisks: Array<{ title: string; severity: string; traceability?: Record<string, unknown> }>;
  recommendedActions: string[];
  generatedAt: string;
  poweredBy: string;
}

export interface LlmConfigResponse {
  provider: string;
  model: string;
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  baseUrl: string | null;
  temperature: number;
  maxTokens: number;
}

export interface TechnicalSizing {
  total_monthly_api_calls: number;
  total_monthly_vector_queries: number;
  total_monthly_llm_tokens: number;
  total_db_size_gb: number;
  total_storage_gb: number;
  total_kv_reads_monthly: number;
  cost_cf_workers: number;
  cost_cf_d1: number;
  cost_cf_vectorize: number;
  cost_cf_workers_ai: number;
  cost_cf_r2: number;
  cost_cf_kv: number;
  total_infra_cost_pm_saas: number;
  total_infra_cost_pm_onprem: number;
  monthly_licence_revenue: number;
  annual_licence_revenue: number;
  gross_margin_pm_saas: number;
  gross_margin_pct_saas: number;
  gross_margin_pm_onprem: number;
  gross_margin_pct_onprem: number;
  catalyst_sizing: Array<{
    catalyst_name: string;
    sub_catalysts: Array<{
      name: string;
      monthly_api_calls: number;
      monthly_llm_tokens: number;
      monthly_vector_queries: number;
      cost_pm_zar: number;
    }>;
    total_cost_pm_zar: number;
  }>;
}

// ── Apex Radar Types ──────────────────────────────────────────────────

export interface RadarSignalItem {
  id: string;
  source: string;
  signalType: 'regulatory' | 'market' | 'competitor' | 'economic' | 'technology' | 'geopolitical';
  title: string;
  description: string;
  url?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  relevanceScore: number;
  status: 'new' | 'analysed' | 'dismissed' | 'expired';
  detectedAt: string;
  expiresAt?: string;
  createdAt: string;
}

export interface RadarSignalCreate {
  source: string;
  signal_type: string;
  title: string;
  description: string;
  url?: string;
  severity?: string;
  raw_data?: Record<string, unknown>;
}

export interface RadarSignalImpactItem {
  id: string;
  dimension: string;
  impactDirection: 'positive' | 'negative' | 'neutral';
  impactMagnitude: number;
  affectedMetrics: string[];
  recommendedActions: string[];
  llmReasoning?: string;
  createdAt: string;
}

export interface RadarImpactWithSignal extends RadarSignalImpactItem {
  signalId: string;
  signalTitle: string;
  signalType: string;
  signalSeverity: string;
}

export interface RadarStrategicContext {
  id: string;
  contextType: 'macro' | 'industry' | 'competitive' | 'regulatory';
  title: string;
  summary: string;
  factors: Array<{ name: string; direction: string; magnitude: number }>;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  confidence: number;
  sourceSignalIds: string[];
  validFrom: string;
  validTo?: string;
  createdAt: string;
}

export interface RadarContextResponse {
  context: RadarStrategicContext | null;
  signals: RadarSignalItem[];
  impacts: RadarSignalImpactItem[];
  summary: {
    totalSignals: number;
    activeSignals: number;
    criticalImpacts: number;
    overallSentiment: string;
  };
}

// ── Pulse Diagnostics Types ───────────────────────────────────────────

export interface DiagnosticAnalysisItem {
  id: string;
  metricId: string;
  metricName: string;
  metricValue: number;
  metricStatus: string;
  triggerType: 'manual' | 'auto' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface DiagnosticCausalChainLink {
  id: string;
  level: number;
  causeType: 'direct' | 'contributing' | 'systemic' | 'environmental' | 'root';
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
  relatedMetrics: string[];
  recommendedFix?: string;
  fixPriority: 'critical' | 'high' | 'medium' | 'low';
  fixEffort: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface DiagnosticFixItem {
  id: string;
  chainId: string;
  analysisId: string;
  chainTitle: string;
  fixPriority: string;
  fixEffort: string;
  metricName: string;
  status: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assignedTo?: string;
  startedAt?: string;
  completedAt?: string;
  outcome?: string;
  notes?: string;
  createdAt: string;
}

export interface DiagnosticSummaryResponse {
  totalAnalyses: number;
  pendingAnalyses: number;
  completedAnalyses: number;
  undiagnosedMetrics: number;
  criticalFindings: number;
  activeFixes: number;
}

export interface DiagnosticAnalysisDetail {
  analysis: DiagnosticAnalysisItem;
  causalChain: DiagnosticCausalChainLink[];
  fixes: DiagnosticFixItem[];
}

// ── Catalyst Intelligence Types ───────────────────────────────────────

export interface CatalystPatternItem {
  id: string;
  patternType: 'recurring_issue' | 'seasonal_trend' | 'cascade_failure' | 'improvement_opportunity' | 'anomaly';
  title: string;
  description: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  affectedClusters: string[];
  affectedSubCatalysts: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved' | 'monitoring';
  recommendedActions: string[];
  createdAt: string;
}

export interface CatalystEffectivenessItem {
  id: string;
  clusterId: string;
  subCatalystName: string;
  periodStart: string;
  periodEnd: string;
  runsCount: number;
  successRate: number;
  avgMatchRate: number;
  avgDurationMs: number;
  totalValueProcessed: number;
  totalExceptions: number;
  improvementTrend: number;
  roiEstimate: number;
  createdAt: string;
}

export interface CatalystDependencyItem {
  id: string;
  sourceClusterId: string;
  sourceSubCatalyst: string;
  targetClusterId: string;
  targetSubCatalyst: string;
  dependencyType: 'data_flow' | 'temporal' | 'causal' | 'resource';
  strength: number;
  description?: string;
  discoveredAt: string;
}

export interface CatalystIntelligenceOverview {
  summary: {
    activePatterns: number;
    criticalPatterns: number;
    totalSubCatalysts: number;
    avgSuccessRate: number;
    totalValueProcessed: number;
    avgRoi: number;
    totalDependencies: number;
  };
  patterns: CatalystPatternItem[];
  effectiveness: CatalystEffectivenessItem[];
  dependencies: CatalystDependencyItem[];
}

export interface CatalystPrescriptionItem {
  id: string;
  patternId: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  expectedImpact: string;
  sapTransaction?: string;
  status: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assignedTo?: string;
  createdAt: string;
}

// ── ROI Tracking Types ────────────────────────────────────────────────

export interface ROITrackingItem {
  id: string;
  totalDiscrepancyValueIdentified: number;
  totalDiscrepancyValueRecovered: number;
  totalPreventedLosses: number;
  totalPersonHoursSaved: number;
  roiMultiple: number;
  platformCost: number;
  calculatedAt: string;
}

export interface ROITrackingResponse extends ROITrackingItem {
  breakdown: {
    byCluster: Array<{ clusterId: string; clusterName: string; recovered: number; prevented: number; hoursSaved: number }>;
  };
}

// ── Board Report Types ────────────────────────────────────────────────

export interface BoardReportItem {
  id: string;
  title: string;
  generatedAt: string;
  reportMonth: string;
  status: 'generating' | 'completed' | 'failed';
  contentMarkdown?: string;
  pdfUrl?: string;
  sections: string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// V2 Spec §4 — Canonical type interfaces matching the Build Spec exactly
// ══════════════════════════════════════════════════════════════════════════════

// §4.1 Radar Types
export interface ExternalSignal {
  id: string;
  category: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  sourceName: string | null;
  reliabilityScore: number;
  relevanceScore: number;
  sentiment: string;
  rawData: Record<string, unknown>;
  detectedAt: string;
  expiresAt: string | null;
}

export interface SignalImpact {
  id: string;
  signalId: string;
  healthDimension: string;
  impactMagnitude: number;
  impactDirection: 'headwind' | 'tailwind';
  impactTimeline: 'immediate' | 'near-term' | 'strategic';
  confidence: number;
  recommendedResponse: string | null;
  analysis: Record<string, unknown>;
  computedAt: string;
}

export interface Competitor {
  id: string;
  name: string;
  industry: string | null;
  estimatedRevenue: string | null;
  marketShare: number | null;
  strengths: string[];
  weaknesses: string[];
  lastUpdated: string;
  signalsCount: number;
}

export interface MarketBenchmark {
  id: string;
  industry: string;
  metricName: string;
  benchmarkValue: number;
  benchmarkUnit: string | null;
  percentile25: number | null;
  percentile50: number | null;
  percentile75: number | null;
  source: string | null;
  measuredAt: string;
}

export interface RegulatoryEvent {
  id: string;
  title: string;
  description: string;
  jurisdiction: string | null;
  affectedDimensions: string[];
  effectiveDate: string | null;
  complianceDeadline: string | null;
  readinessScore: number;
  status: string;
  sourceUrl: string | null;
}

export interface StrategicContext {
  healthScore: number;
  industryBenchmark: number | null;
  headwinds: SignalImpact[];
  tailwinds: SignalImpact[];
  competitorCount: number;
  regulatoryDeadlines: number;
  topSignals: ExternalSignal[];
  contextNarrative: string;
}

// §4.2 Diagnostics Types
export interface RootCauseAnalysis {
  id: string;
  metricId: string;
  metricName: string;
  triggerStatus: string;
  causalChain: CausalFactor[];
  confidence: number;
  impactSummary: string | null;
  prescription: Record<string, unknown>;
  status: string;
  sourceDataRefs: Record<string, unknown>;
  generatedAt: string;
  resolvedAt: string | null;
}

export interface CausalFactor {
  id: string;
  layer: string;
  factorType: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  impactValue: number | null;
  impactUnit: string;
  confidence: number;
  sourceRunIds: string[];
  sourceMetricIds: string[];
  createdAt: string;
}

export interface DiagnosticPrescription {
  id: string;
  rcaId: string;
  priority: 'immediate' | 'short-term' | 'strategic';
  title: string;
  description: string;
  expectedImpact: string | null;
  effortLevel: 'low' | 'medium' | 'high';
  responsibleDomain: string | null;
  deadlineSuggested: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DiagnosticsSummary {
  totalActive: number;
  bySeverity: Record<string, number>;
  prescriptionsPending: number;
  prescriptionsCompleted: number;
  totalImpactValue: number;
  undiagnosedMetrics: number;
  // Legacy aliases
  totalAnalyses?: number;
  pendingAnalyses?: number;
  completedAnalyses?: number;
  criticalFindings?: number;
  activeFixes?: number;
}

// §4.3 Catalyst Intelligence Types
export interface CatalystPattern {
  id: string;
  clusterId: string;
  subCatalystName: string;
  patternType: 'discrepancy_clustering' | 'exception_recurrence' | 'temporal_pattern' | 'field_hotspot';
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  affectedRecordsPct: number;
  confidence: number;
  firstDetected: string;
  lastConfirmed: string;
  runCount: number;
  severity: string;
  status: string;
  prescriptionId: string | null;
}

export interface CatalystEffectivenessData {
  id: string;
  clusterId: string;
  subCatalystName: string;
  period: string;
  runsCount: number;
  totalItemsProcessed: number;
  totalDiscrepancyValueFound: number;
  totalDiscrepancyValueResolved: number;
  recoveryRate: number;
  avgMatchRate: number;
  avgMatchRateTrend: number[];
  avgConfidenceTrend: number[];
  avgDurationTrend: number[];
  interventionImpacts: Array<{ date: string; type: string; effect: number }>;
}

export interface CatalystDependency {
  id: string;
  upstreamClusterId: string;
  upstreamSubName: string;
  downstreamClusterId: string;
  downstreamSubName: string;
  dependencyType: string;
  lagHours: number;
  correlationStrength: number;
  cascadeRiskScore: number;
  evidence: Record<string, unknown>;
  lastConfirmed: string | null;
}

// §4.4 ROI & Board Report Types
export interface ROISummary {
  identified: number;
  recovered: number;
  lossesAverted: number;
  personHoursSaved: number;
  roiMultiple: number;
  totalCatalystRuns: number;
  licenceCostAnnual: number;
  period: string;
  calculatedAt: string;
  // Aliases for compat with existing ROITrackingResponse
  totalDiscrepancyValueIdentified?: number;
  totalDiscrepancyValueRecovered?: number;
  totalPreventedLosses?: number;
  totalPersonHoursSaved?: number;
}

export interface BoardReport {
  id: string;
  title: string;
  reportType: string;
  content: Record<string, unknown> | string;
  r2Key: string | null;
  pdfUrl: string | null;
  generatedBy: string | null;
  generatedAt: string;
}

// §9.2 Onboarding
export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  completedAt: string | null;
}
export interface OnboardingProgressResponse {
  steps: OnboardingStep[];
  completedCount: number;
  totalSteps: number;
  progressPct: number;
  allComplete: boolean;
}

// §9.3 Freshness
export interface FreshnessSection {
  section: string;
  lastUpdated: string | null;
  ageMinutes: number | null;
  status: 'fresh' | 'stale' | 'unknown';
}
export interface FreshnessResponse {
  globalStatus: 'fresh' | 'stale' | 'unknown';
  oldestAgeMinutes: number | null;
  sections: FreshnessSection[];
  checkedAt: string;
}

// §11.7 Atheon Score
export interface AtheonScoreComponent {
  name: string;
  weight: number;
  score: number;
  weighted: number;
}
export interface AtheonScoreResponse {
  score: number;
  components: AtheonScoreComponent[];
  trend: { score: number; date: string }[];
  industryAvg: number | null;
}

// §11.1 Trial Assessment
export interface TrialResultsResponse {
  id: string;
  companyName: string;
  industry: string;
  status: string;
  healthScore: number | null;
  issuesFound: number | null;
  estimatedExposure: number | null;
  topRisks: { title: string; description: string; impact: number }[];
  topOpportunities: { title: string; description: string; value: number }[];
  projectedRoi: number | null;
  completedAt: string | null;
}
export interface TrialReportResponse {
  companyName: string;
  industry: string;
  healthScore: number | null;
  issuesFound: number | null;
  estimatedExposure: number | null;
  topRisks: { title: string; description: string; impact: number }[];
  topOpportunities: { title: string; description: string; value: number }[];
  projectedRoi: number | null;
  generatedAt: string;
}

// §11.2 Baseline Snapshots
export interface BaselineSnapshot {
  id: string;
  snapshotType: string;
  healthScore: number;
  dimensions: Record<string, unknown>;
  metricCountGreen: number;
  metricCountAmber: number;
  metricCountRed: number;
  totalDiscrepancyValue: number;
  totalProcessConformance: number;
  avgCatalystSuccessRate: number;
  roiAtSnapshot: number;
  capturedAt: string;
}
export interface BaselineComparisonResponse {
  dayZero: BaselineSnapshot | null;
  current: BaselineSnapshot | null;
  improvement: {
    healthScore: number;
    metricCountGreen: number;
    discrepancyValue: number;
    processConformance: number;
    catalystSuccessRate: number;
    roi: number;
  } | null;
  narrative: string;
}

// §11.3 Goal Setting
export interface HealthTarget {
  id: string;
  targetType: string;
  targetName: string;
  targetValue: number;
  targetDeadline: string | null;
  currentValue: number;
  status: string;
  gap: number;
  projectedAchieveDate: string | null;
  createdAt: string;
  achievedAt: string | null;
}

// §11.4 Peer Benchmarks
export interface PeerBenchmarkItem {
  dimension: string;
  period: string;
  tenantCount: number;
  avgScore: number;
  p25Score: number;
  p50Score: number;
  p75Score: number;
  minScore: number;
  maxScore: number;
  ownScore: number | null;
  percentileRank: string | null;
  calculatedAt: string;
}
export interface PeerBenchmarksResponse {
  industry: string;
  benchmarks: PeerBenchmarkItem[];
  total: number;
}

// §11.5 Cost of Inaction
export interface CostOfInactionRca {
  rcaId: string;
  metricName: string;
  severity: string;
  daysOpen: number;
  pendingPrescriptions: number;
}
export interface CostOfInactionResponse {
  totalExposure: number;
  dailyCost: number;
  accruedCost: number;
  projectedMonthlyCost: number;
  activeRcaCount: number;
  avgDaysOpen: number;
  rcaBreakdown: CostOfInactionRca[];
}

// §11.6 Success Stories
export interface SuccessStory {
  patternSignature: string;
  resolutionCount: number;
  avgResolutionDays: number;
  avgValueRecovered: number;
  commonFixTypes: string[];
  lastUpdated: string;
}
export interface SuccessStoriesResponse {
  industry: string;
  stories: SuccessStory[];
  total: number;
}

// ── Value Assessment Engine Types ──
export interface ValueAssessmentFinding {
  id: string;
  assessment_id: string;
  run_id: string;
  tenant_id: string;
  finding_type: 'discrepancy' | 'exception' | 'data_quality' | 'process_delay' | 'risk';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affected_records: number;
  financial_impact: number;
  evidence: {
    sample_records?: Array<{ ref: string; source_value: string | number; target_value: string | number; difference: number }>;
    pattern?: string;
    first_occurrence?: string;
    frequency?: string;
  };
  root_cause: string | null;
  prescription: string | null;
  category: string;
  immediate_value: number;
  ongoing_monthly_value: number;
  domain: string;
  created_at: string;
}

export interface DataQualityRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  table_name: string;
  total_records: number;
  complete_records: number;
  completeness_pct: number;
  field_scores: Record<string, number>;
  referential_issues: number;
  duplicate_records: number;
  orphan_records: number;
  stale_records: number;
  overall_quality_score: number;
  issues: Array<{ field: string; issue: string; count: number; severity: string; financialImpact: number }>;
  created_at: string;
}

export interface ProcessTimingRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  process_name: string;
  avg_cycle_time_days: number;
  median_cycle_time_days: number;
  p90_cycle_time_days: number;
  benchmark_cycle_time_days: number;
  bottleneck_step: string | null;
  bottleneck_avg_days: number;
  records_analysed: number;
  records_exceeding_benchmark: number;
  financial_impact_of_delay: number;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface ValueSummaryRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  total_immediate_value: number;
  total_ongoing_monthly_value: number;
  total_ongoing_annual_value: number;
  total_data_quality_issues: number;
  total_process_delays: number;
  total_findings: number;
  total_critical_findings: number;
  outcome_based_monthly_fee: number;
  outcome_based_fee_pct: number;
  payback_days: number;
  value_by_domain: Record<string, { immediate: number; ongoing: number; findings: number }>;
  value_by_category: Record<string, { immediate: number; ongoing: number; findings: number }>;
  executive_narrative: string;
  created_at: string;
}

// §11.8 Executive Summary
export interface ExecutiveSummaryResponse {
  atheonScore: number;
  healthScore: number;
  dimensions: Record<string, { score: number; trend?: string }>;
  roi: { recovered: number; multiple: number; cost: number };
  diagnostics: { activeRcas: number; pendingPrescriptions: number };
  signals: { newThisWeek: number };
  topRisks: { title: string; severity: string; impactValue: number }[];
  targets: { targetType: string; targetName: string; targetValue: number; currentValue: number; status: string }[];
  trend: { score: number; date: string }[];
  journey: { baselineHealthScore: number | null; baselineDate: string | null; improvement: number | null };
}
