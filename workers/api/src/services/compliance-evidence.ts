/**
 * SOC 2 control evidence aggregation.
 *
 * Read-only over existing tables (audit_log, users, support_tickets,
 * erp_connections, iam_custom_roles, provenance_chain). No new tables,
 * no schema changes. Each function returns a small evidence object the
 * /compliance page renders as a card; the route composes them all.
 *
 * Scope is deliberately narrow — these are the controls procurement teams
 * ask about most often: access reviews, MFA enforcement, configuration
 * changes, incident response, user deprovisioning, encryption posture,
 * and audit log retention. SOC 2 also asks about change management,
 * vulnerability management, and disaster recovery — those live in the
 * runbook + GitHub Actions history rather than the database.
 */

const ADMIN_ACTION_PATTERNS = [
  'admin.', 'iam.', 'sso_', 'tenant_', 'bulk.user_', 'controlplane.', 'webhook.',
] as const;

export interface AccessReviewEvidence {
  /** Active users with admin+ role today. */
  activeAdminCount: number;
  /** Users in admin+ role assigned in the last 90 days. */
  adminsAssignedLast90d: number;
  /** Users whose role was changed in the last 90 days. */
  roleChangesLast90d: number;
  /** Users with MFA enabled today. */
  mfaEnabledCount: number;
  /** Total active users (excl. terminated). */
  activeUserCount: number;
}

export interface MfaPostureEvidence {
  totalUsers: number;
  mfaEnabled: number;
  mfaCoveragePct: number;
  /** Admin-tier users still inside the grace window (need to enrol). */
  adminsInGracePeriod: number;
  /** Admin-tier users who never enrolled and grace expired (high risk). */
  adminsExpiredGrace: number;
}

export interface ConfigChangeEvidence {
  /** Audit-log entries matching admin/iam/sso/etc. patterns over the window. */
  changesLast30d: number;
  changesLast90d: number;
  topActions: Array<{ action: string; count: number }>;
}

export interface IncidentResponseEvidence {
  totalCriticalLast90d: number;
  resolvedCriticalLast90d: number;
  openCritical: number;
  /** Median resolution time in hours for P0/critical tickets. */
  medianResolutionHours: number | null;
}

export interface DeprovisioningEvidence {
  /** Users moved to status='disabled' or 'terminated' in last 90 days. */
  deprovisionedLast90d: number;
  /** Currently-disabled users. */
  currentlyDisabled: number;
  /** Disabled users still showing role>=manager (review required). */
  privilegedDisabled: number;
}

export interface EncryptionEvidence {
  /** ERP connections with credentials in encrypted_config column. */
  erpEncrypted: number;
  /** ERP connections still using a legacy plaintext config column. */
  erpPlaintext: number;
  totalConnections: number;
}

export interface AuditRetentionEvidence {
  totalRows: number;
  oldestEventAt: string | null;
  /** ISO date one year ago — anything older is over the SOC 2 default retention. */
  oneYearAgo: string;
  /** Provenance chain length (separate immutable record). */
  provenanceChainLength: number;
}

export interface EvidencePack {
  generatedAt: string;
  tenantId: string;
  generatedBy: string;
  accessReviews: AccessReviewEvidence;
  mfa: MfaPostureEvidence;
  configChanges: ConfigChangeEvidence;
  incidentResponse: IncidentResponseEvidence;
  deprovisioning: DeprovisioningEvidence;
  encryption: EncryptionEvidence;
  auditRetention: AuditRetentionEvidence;
}

const ADMIN_ROLES = ['superadmin', 'support_admin', 'admin'] as const;
const PRIVILEGED_ROLES = [...ADMIN_ROLES, 'executive', 'manager'] as const;

export async function collectAccessReviews(db: D1Database, tenantId: string): Promise<AccessReviewEvidence> {
  const adminClause = ADMIN_ROLES.map(() => '?').join(',');
  const adminBinds = ADMIN_ROLES as readonly string[];

  const [active, mfa, recentAdmins, roleChanges] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active'`)
      .bind(tenantId).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active' AND mfa_enabled = 1`)
      .bind(tenantId).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active' AND role IN (${adminClause}) AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId, ...adminBinds).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action LIKE 'iam.%' AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId).first<{ c: number }>(),
  ]);

  const activeAdminRow = await db.prepare(
    `SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active' AND role IN (${adminClause})`,
  ).bind(tenantId, ...adminBinds).first<{ c: number }>();

  return {
    activeAdminCount: activeAdminRow?.c || 0,
    adminsAssignedLast90d: recentAdmins?.c || 0,
    roleChangesLast90d: roleChanges?.c || 0,
    mfaEnabledCount: mfa?.c || 0,
    activeUserCount: active?.c || 0,
  };
}

export async function collectMfaPosture(db: D1Database, tenantId: string): Promise<MfaPostureEvidence> {
  const adminClause = ADMIN_ROLES.map(() => '?').join(',');
  const adminBinds = ADMIN_ROLES as readonly string[];
  const [totals, gracing, expired] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN mfa_enabled = 1 THEN 1 ELSE 0 END) AS enabled FROM users WHERE tenant_id = ? AND status = 'active'`)
      .bind(tenantId).first<{ total: number; enabled: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active' AND mfa_enabled = 0 AND role IN (${adminClause}) AND mfa_grace_until IS NOT NULL AND mfa_grace_until > datetime('now')`)
      .bind(tenantId, ...adminBinds).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status = 'active' AND mfa_enabled = 0 AND role IN (${adminClause}) AND (mfa_grace_until IS NULL OR mfa_grace_until <= datetime('now'))`)
      .bind(tenantId, ...adminBinds).first<{ c: number }>(),
  ]);
  const total = totals?.total || 0;
  const enabled = totals?.enabled || 0;
  return {
    totalUsers: total,
    mfaEnabled: enabled,
    mfaCoveragePct: total > 0 ? Math.round((enabled / total) * 1000) / 10 : 0,
    adminsInGracePeriod: gracing?.c || 0,
    adminsExpiredGrace: expired?.c || 0,
  };
}

export async function collectConfigChanges(db: D1Database, tenantId: string): Promise<ConfigChangeEvidence> {
  const likeClause = ADMIN_ACTION_PATTERNS.map(() => 'action LIKE ?').join(' OR ');
  const likeBinds = ADMIN_ACTION_PATTERNS.map(p => `${p}%`);
  const [count30, count90, top] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND (${likeClause}) AND created_at >= datetime('now', '-30 days')`)
      .bind(tenantId, ...likeBinds).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND (${likeClause}) AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId, ...likeBinds).first<{ c: number }>(),
    db.prepare(`SELECT action, COUNT(*) AS count FROM audit_log WHERE tenant_id = ? AND (${likeClause}) AND created_at >= datetime('now', '-90 days') GROUP BY action ORDER BY count DESC LIMIT 8`)
      .bind(tenantId, ...likeBinds).all<{ action: string; count: number }>(),
  ]);
  return {
    changesLast30d: count30?.c || 0,
    changesLast90d: count90?.c || 0,
    topActions: top.results || [],
  };
}

export async function collectIncidentResponse(db: D1Database, tenantId: string): Promise<IncidentResponseEvidence> {
  // Define "critical" as priority='critical' or 'high'. Tickets table only has
  // priority + status — resolution time is `updated_at - created_at` when
  // status transitions to 'resolved'.
  const [totals, resolved, open] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM support_tickets WHERE tenant_id = ? AND priority IN ('critical', 'high') AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId).first<{ c: number }>(),
    db.prepare(`SELECT updated_at, created_at FROM support_tickets WHERE tenant_id = ? AND priority IN ('critical', 'high') AND status = 'resolved' AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId).all<{ updated_at: string; created_at: string }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM support_tickets WHERE tenant_id = ? AND priority IN ('critical', 'high') AND status NOT IN ('resolved', 'closed')`)
      .bind(tenantId).first<{ c: number }>(),
  ]);
  const durations = (resolved.results || []).map(r => {
    const start = new Date(r.created_at).getTime();
    const end = new Date(r.updated_at).getTime();
    return Math.max(0, (end - start) / 36e5);
  }).sort((a, b) => a - b);
  const median = durations.length === 0
    ? null
    : Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10;
  return {
    totalCriticalLast90d: totals?.c || 0,
    resolvedCriticalLast90d: durations.length,
    openCritical: open?.c || 0,
    medianResolutionHours: median,
  };
}

export async function collectDeprovisioning(db: D1Database, tenantId: string): Promise<DeprovisioningEvidence> {
  const privClause = PRIVILEGED_ROLES.map(() => '?').join(',');
  const privBinds = PRIVILEGED_ROLES as readonly string[];
  const [recent, current, priv] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE tenant_id = ? AND action IN ('iam.user.disabled', 'iam.user.deleted', 'auth.user_terminated', 'admin.user.disable') AND created_at >= datetime('now', '-90 days')`)
      .bind(tenantId).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status IN ('disabled', 'terminated', 'inactive')`)
      .bind(tenantId).first<{ c: number }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND status IN ('disabled', 'terminated', 'inactive') AND role IN (${privClause})`)
      .bind(tenantId, ...privBinds).first<{ c: number }>(),
  ]);
  return {
    deprovisionedLast90d: recent?.c || 0,
    currentlyDisabled: current?.c || 0,
    privilegedDisabled: priv?.c || 0,
  };
}

export async function collectEncryption(db: D1Database, tenantId: string): Promise<EncryptionEvidence> {
  const row = await db.prepare(
    `SELECT
        SUM(CASE WHEN encrypted_config IS NOT NULL AND encrypted_config != '' THEN 1 ELSE 0 END) AS encrypted,
        SUM(CASE WHEN (encrypted_config IS NULL OR encrypted_config = '') THEN 1 ELSE 0 END) AS plaintext,
        COUNT(*) AS total
       FROM erp_connections WHERE tenant_id = ?`,
  ).bind(tenantId).first<{ encrypted: number; plaintext: number; total: number }>();
  return {
    erpEncrypted: row?.encrypted || 0,
    erpPlaintext: row?.plaintext || 0,
    totalConnections: row?.total || 0,
  };
}

export async function collectAuditRetention(db: D1Database, tenantId: string): Promise<AuditRetentionEvidence> {
  const [audit, prov] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS c, MIN(created_at) AS oldest FROM audit_log WHERE tenant_id = ?`)
      .bind(tenantId).first<{ c: number; oldest: string | null }>(),
    db.prepare(`SELECT COUNT(*) AS c FROM provenance_chain WHERE tenant_id = ?`)
      .bind(tenantId).first<{ c: number }>(),
  ]);
  const oneYearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString();
  return {
    totalRows: audit?.c || 0,
    oldestEventAt: audit?.oldest || null,
    oneYearAgo,
    provenanceChainLength: prov?.c || 0,
  };
}

export async function buildEvidencePack(
  db: D1Database,
  tenantId: string,
  generatedBy: string,
): Promise<EvidencePack> {
  const [accessReviews, mfa, configChanges, incidentResponse, deprovisioning, encryption, auditRetention] = await Promise.all([
    collectAccessReviews(db, tenantId),
    collectMfaPosture(db, tenantId),
    collectConfigChanges(db, tenantId),
    collectIncidentResponse(db, tenantId),
    collectDeprovisioning(db, tenantId),
    collectEncryption(db, tenantId),
    collectAuditRetention(db, tenantId),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    tenantId,
    generatedBy,
    accessReviews,
    mfa,
    configChanges,
    incidentResponse,
    deprovisioning,
    encryption,
    auditRetention,
  };
}
