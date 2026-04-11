/**
 * SPEC-003: Backend Route Decomposition — Catalyst Helpers
 * Extracted helper functions from catalysts.ts to reduce file size and improve maintainability.
 * These helpers handle domain mapping, risk generation, and insight calculation.
 */

/** Map a catalyst domain to the health-score dimension(s) it affects */
export function domainToDimensions(domain: string): string[] {
  const map: Record<string, string[]> = {
    'finance': ['financial'],
    'procurement': ['operational', 'financial'],
    'supply-chain': ['operational'],
    'hr': ['operational', 'strategic'],
    'sales': ['financial', 'strategic'],
    'mining-safety': ['compliance'],
    'mining-environment': ['compliance'],
    'health-compliance': ['compliance'],
    'health-supply': ['technology', 'operational'],
    'health-patient': ['operational'],
    'health-staffing': ['operational'],
    'health-experience': ['strategic', 'operational'],
    'mining-equipment': ['technology', 'operational'],
    'mining-ore': ['operational'],
    'agri-crop': ['operational', 'technology'],
    'agri-irrigation': ['technology'],
    'agri-quality': ['compliance'],
    'agri-market': ['strategic'],
    'logistics-fleet': ['operational'],
    'logistics-warehouse': ['operational'],
    'logistics-compliance': ['compliance'],
    'tech-devops': ['technology'],
    'tech-security': ['technology', 'compliance'],
    'tech-product': ['strategic', 'technology'],
    'tech-customer-success': ['strategic', 'operational'],
    'mfg-production': ['operational'],
    'mfg-quality': ['compliance', 'operational'],
    'mfg-maintenance': ['technology', 'operational'],
    'mfg-energy': ['technology', 'operational'],
    'fmcg-trade': ['financial', 'strategic'],
    'fmcg-distributor': ['operational', 'strategic'],
    'fmcg-launch': ['strategic'],
    'fmcg-shelf': ['strategic', 'operational'],
  };
  return map[domain] || ['operational'];
}

/** Map a catalyst domain to its primary risk category */
export function domainToRiskCategory(domain: string): string {
  if (domain.includes('compliance') || domain.includes('safety') || domain.includes('environment') || domain.includes('quality')) return 'compliance';
  if (domain.includes('finance') || domain.startsWith('fin-') || domain === 'sales' || domain === 'procurement') return 'financial';
  if (domain.includes('tech') || domain.includes('data') || domain.includes('devops') || domain.includes('security')) return 'technology';
  return 'operational';
}

/** Human-friendly label for a domain key */
export function friendlyDomain(domain: string): string {
  const map: Record<string, string> = {
    'finance': 'Financial Operations',
    'procurement': 'Procurement & Sourcing',
    'supply-chain': 'Supply Chain',
    'hr': 'Human Resources',
    'sales': 'Sales & Revenue',
    'mining-safety': 'Workplace Safety',
    'mining-environment': 'Environmental Compliance',
    'mining-equipment': 'Equipment & Machinery',
    'mining-ore': 'Ore Processing & Quality',
    'health-compliance': 'Healthcare Compliance',
    'health-supply': 'Medical Supply Chain',
    'health-patient': 'Patient Care',
    'health-staffing': 'Staffing & Workforce',
    'health-experience': 'Patient Experience',
    'agri-crop': 'Crop Management',
    'agri-irrigation': 'Irrigation Systems',
    'agri-quality': 'Produce Quality',
    'agri-market': 'Market & Pricing',
    'logistics-fleet': 'Fleet Management',
    'logistics-warehouse': 'Warehouse Operations',
    'logistics-compliance': 'Logistics Compliance',
    'tech-devops': 'DevOps & Infrastructure',
    'tech-security': 'Cybersecurity',
    'tech-product': 'Product Development',
    'tech-customer-success': 'Customer Success',
    'mfg-production': 'Production Line',
    'mfg-quality': 'Quality Assurance',
    'mfg-maintenance': 'Plant Maintenance',
    'mfg-energy': 'Energy Management',
    'fmcg-trade': 'Trade Spend',
    'fmcg-distributor': 'Distributor Network',
    'fmcg-launch': 'Product Launch',
    'fmcg-shelf': 'Shelf Performance',
  };
  return map[domain] || domain.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Human-friendly label for a risk category */
export function friendlyCategory(cat: string): string {
  const map: Record<string, string> = {
    'compliance': 'Compliance & Governance',
    'financial': 'Financial',
    'technology': 'Technology & Systems',
    'operational': 'Operational',
  };
  return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

/** Human-friendly label for a dimension key */
export function friendlyDimension(dim: string): string {
  const map: Record<string, string> = {
    'financial': 'Financial Health',
    'operational': 'Operational Efficiency',
    'compliance': 'Compliance & Governance',
    'strategic': 'Strategic Alignment',
    'technology': 'Technology Readiness',
    'risk': 'Risk Posture',
    'catalyst': 'Catalyst Performance',
    'process': 'Process Maturity',
  };
  return map[dim] || dim.charAt(0).toUpperCase() + dim.slice(1);
}

/** Generate a human-friendly risk title based on severity and domain */
export function friendlyRiskTitle(severity: string, domain: string): string {
  const domainLabel = friendlyDomain(domain);
  if (severity === 'high') return `Elevated risk detected in ${domainLabel}`;
  if (severity === 'medium') return `Moderate concern flagged in ${domainLabel}`;
  return `Minor observation noted in ${domainLabel}`;
}

/** Generate a human-friendly risk description */
export function friendlyRiskDescription(severity: string, domain: string, catalystName: string): string {
  const domainLabel = friendlyDomain(domain);
  if (severity === 'high') {
    return `During routine analysis, ${catalystName} identified a significant risk indicator within ${domainLabel}. This warrants immediate attention.`;
  }
  if (severity === 'medium') {
    return `${catalystName} flagged a moderate-level concern within ${domainLabel}. This should be reviewed within the current planning cycle.`;
  }
  return `${catalystName} noted a low-level observation within ${domainLabel}. No immediate action is needed.`;
}

/** Check if a role has admin-level privileges */
export function isAdminRole(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'system_admin';
}

/** Check if a role can override tenant_id (cross-tenant access) */
export function canCrossTenant(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'system_admin';
}

/** Calculate next run time for scheduled sub-catalysts */
export function calculateNextRun(
  frequency: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timeOfDay?: string,
): string {
  const now = new Date();
  const [hours, minutes] = (timeOfDay || '06:00').split(':').map(Number);

  if (frequency === 'daily') {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }

  if (frequency === 'weekly' && dayOfWeek !== undefined) {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    const currentDay = next.getUTCDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= now) daysUntil = 7;
    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next.toISOString();
  }

  if (frequency === 'monthly' && dayOfMonth !== undefined) {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    next.setUTCDate(dayOfMonth);
    if (next <= now) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(dayOfMonth);
    }
    return next.toISOString();
  }

  return '';
}

/** Write an execution log entry */
export async function writeLog(
  db: D1Database,
  tenantId: string,
  actionId: string,
  stepNumber: number,
  stepName: string,
  status: string,
  detail: string,
  durationMs?: number,
): Promise<void> {
  try {
    if (status !== 'running') {
      const updated = await db.prepare(
        'UPDATE execution_logs SET status = ?, detail = ?, duration_ms = ? WHERE tenant_id = ? AND action_id = ? AND step_number = ? AND step_name = ? AND status = ?'
      ).bind(status, detail, durationMs ?? null, tenantId, actionId, stepNumber, stepName, 'running').run();
      if (updated.meta.changes && updated.meta.changes > 0) return;
    }
    await db.prepare(
      'INSERT INTO execution_logs (id, tenant_id, action_id, step_number, step_name, status, detail, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, actionId, stepNumber, stepName, status, detail, durationMs ?? null).run();
  } catch (err) { console.error('writeLog: execution_logs table may not exist yet:', err); }
}

/** Safely parse JSON, returning fallback on failure */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try { return JSON.parse(str); } catch { return fallback; }
}

/** Known ERP/financial fields for fuzzy matching */
export const KNOWN_FIELDS = [
  'invoice_number', 'invoice_date', 'due_date', 'total_amount', 'tax_amount',
  'currency', 'status', 'customer_name', 'supplier_name', 'description',
  'quantity', 'unit_price', 'discount', 'line_total', 'account_code',
  'account_name', 'gl_code', 'cost_center', 'department', 'project',
  'payment_date', 'payment_method', 'reference', 'po_number', 'so_number',
  'contact_name', 'contact_email', 'contact_phone', 'address',
  'product_name', 'product_code', 'category', 'subcategory',
] as const;
