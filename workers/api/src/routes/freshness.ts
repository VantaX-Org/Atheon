/**
 * Data Freshness Routes — Spec §9.3
 * Global freshness indicator + per-section freshness labels.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const freshness = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

interface FreshnessSection {
  section: string;
  lastUpdated: string | null;
  ageMinutes: number | null;
  status: 'fresh' | 'stale' | 'unknown';
}

// GET /api/freshness
freshness.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const now = Date.now();

  // Query latest timestamps from each data source
  const [health, signals, rcas, patterns, roi, briefing, catalystRuns] = await Promise.all([
    c.env.DB.prepare('SELECT calculated_at as ts FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare('SELECT detected_at as ts FROM external_signals WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare('SELECT generated_at as ts FROM root_cause_analyses WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare('SELECT last_confirmed as ts FROM catalyst_patterns WHERE tenant_id = ? ORDER BY last_confirmed DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare('SELECT calculated_at as ts FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare('SELECT created_at as ts FROM briefings WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1').bind(tenantId).first<{ ts: string }>(),
    c.env.DB.prepare("SELECT MAX(started_at) as ts FROM catalyst_runs WHERE tenant_id = ?").bind(tenantId).first<{ ts: string }>(),
  ]);

  function buildSection(section: string, row: { ts: string } | null): FreshnessSection {
    if (!row?.ts) return { section, lastUpdated: null, ageMinutes: null, status: 'unknown' };
    const age = Math.round((now - new Date(row.ts).getTime()) / 60000);
    // Fresh = < 60 min, Stale = > 24 hours
    const status = age < 60 ? 'fresh' : age > 1440 ? 'stale' : 'fresh';
    return { section, lastUpdated: row.ts, ageMinutes: age, status };
  }

  const sections: FreshnessSection[] = [
    buildSection('Health Score', health),
    buildSection('External Signals', signals),
    buildSection('Diagnostics (RCA)', rcas),
    buildSection('Catalyst Patterns', patterns),
    buildSection('ROI Tracking', roi),
    buildSection('Executive Briefing', briefing),
    buildSection('Catalyst Runs', catalystRuns),
  ];

  // Global freshness: worst status across all sections
  const staleCount = sections.filter(s => s.status === 'stale').length;
  const unknownCount = sections.filter(s => s.status === 'unknown').length;
  const globalStatus = staleCount > 0 ? 'stale' : unknownCount === sections.length ? 'unknown' : 'fresh';

  // Oldest data point
  const ages = sections.filter(s => s.ageMinutes !== null).map(s => s.ageMinutes as number);
  const oldestAgeMinutes = ages.length > 0 ? Math.max(...ages) : null;

  return c.json({
    globalStatus,
    oldestAgeMinutes,
    sections,
    checkedAt: new Date().toISOString(),
  });
});

export default freshness;
