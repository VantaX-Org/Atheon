/**
 * SPEC-028: Scheduled Report Delivery
 * Generate and deliver scheduled reports via email (PDF/CSV).
 */

export interface ReportSchedule {
  id: string;
  tenantId: string;
  name: string;
  type: 'executive_summary' | 'health_report' | 'risk_assessment' | 'catalyst_performance' | 'financial_overview' | 'custom';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  recipients: string[];
  format: 'pdf' | 'csv' | 'html';
  filters?: Record<string, unknown>;
  enabled: boolean;
  lastSentAt?: string;
  nextSendAt?: string;
  createdBy: string;
}

export interface ReportData {
  title: string;
  generatedAt: string;
  tenantName: string;
  sections: ReportSection[];
  summary: string;
}

export interface ReportSection {
  title: string;
  type: 'text' | 'table' | 'chart' | 'metric_grid';
  content: string | Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}

/** Generate report data based on type */
export async function generateReportData(
  db: D1Database,
  tenantId: string,
  type: ReportSchedule['type'],
): Promise<ReportData> {
  const generatedAt = new Date().toISOString();

  // Get tenant name
  const tenant = await db.prepare('SELECT name FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string }>();
  const tenantName = tenant?.name || 'Unknown Tenant';

  const sections: ReportSection[] = [];

  switch (type) {
    case 'executive_summary': {
      // Health score
      const health = await db.prepare(
        'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(tenantId).first();

      sections.push({
        title: 'Health Score Overview',
        type: 'text',
        content: `Current overall health score: ${health?.overall_score ?? 'N/A'}. ${health ? 'Score calculated from multiple business dimensions.' : 'No health data available yet.'}`,
      });

      // Active risks
      const risks = await db.prepare(
        'SELECT COUNT(*) as count FROM risks WHERE tenant_id = ? AND status = ?'
      ).bind(tenantId, 'active').first<{ count: number }>();

      sections.push({
        title: 'Risk Summary',
        type: 'text',
        content: `Active risks: ${risks?.count ?? 0}`,
      });

      // Recent catalyst runs
      const catalystRuns = await db.prepare(
        'SELECT COUNT(*) as count FROM catalyst_runs WHERE tenant_id = ? AND created_at > datetime(\'now\', \'-7 days\')'
      ).bind(tenantId).first<{ count: number }>();

      sections.push({
        title: 'Catalyst Activity (Last 7 Days)',
        type: 'text',
        content: `Catalyst runs completed: ${catalystRuns?.count ?? 0}`,
      });
      break;
    }

    case 'health_report': {
      const healthHistory = await db.prepare(
        'SELECT overall_score, dimensions, created_at FROM health_scores WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30'
      ).bind(tenantId).all();

      sections.push({
        title: 'Health Score Trend',
        type: 'table',
        content: (healthHistory.results || []).map((h: Record<string, unknown>) => ({
          date: h.created_at,
          score: h.overall_score,
        })),
      });
      break;
    }

    case 'risk_assessment': {
      const risks = await db.prepare(
        'SELECT title, severity, status, created_at FROM risks WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50'
      ).bind(tenantId).all();

      sections.push({
        title: 'Risk Register',
        type: 'table',
        content: (risks.results || []).map((r: Record<string, unknown>) => ({
          title: r.title,
          severity: r.severity,
          status: r.status,
          identified: r.created_at,
        })),
      });
      break;
    }

    case 'catalyst_performance': {
      const runs = await db.prepare(
        'SELECT catalyst_id, status, duration_ms, created_at FROM catalyst_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100'
      ).bind(tenantId).all();

      sections.push({
        title: 'Catalyst Run History',
        type: 'table',
        content: (runs.results || []).map((r: Record<string, unknown>) => ({
          catalyst: r.catalyst_id,
          status: r.status,
          duration: `${Math.round((r.duration_ms as number || 0) / 1000)}s`,
          date: r.created_at,
        })),
      });
      break;
    }

    default:
      sections.push({
        title: 'Report',
        type: 'text',
        content: 'Custom report type — configure sections as needed.',
      });
  }

  return {
    title: `${type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} Report`,
    generatedAt,
    tenantName,
    sections,
    summary: `Report generated for ${tenantName} on ${new Date(generatedAt).toLocaleDateString()}.`,
  };
}

/** Convert report data to HTML for email delivery */
export function reportToHtml(report: ReportData): string {
  const sectionHtml = report.sections.map(section => {
    if (section.type === 'text') {
      return `<h3 style="color:#4A6B5A;margin:16px 0 8px;">${section.title}</h3><p style="color:#555;line-height:1.6;">${section.content}</p>`;
    }
    if (section.type === 'table' && Array.isArray(section.content)) {
      if (section.content.length === 0) {
        return `<h3 style="color:#4A6B5A;margin:16px 0 8px;">${section.title}</h3><p style="color:#999;">No data available.</p>`;
      }
      const headers = Object.keys(section.content[0]);
      const headerRow = headers.map(h => `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #4A6B5A;color:#4A6B5A;font-size:12px;text-transform:uppercase;">${h}</th>`).join('');
      const bodyRows = section.content.map(row =>
        `<tr>${headers.map(h => `<td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:13px;color:#333;">${(row as Record<string, unknown>)[h] ?? ''}</td>`).join('')}</tr>`
      ).join('');
      return `<h3 style="color:#4A6B5A;margin:16px 0 8px;">${section.title}</h3><table style="width:100%;border-collapse:collapse;"><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
    return `<h3 style="color:#4A6B5A;margin:16px 0 8px;">${section.title}</h3><p style="color:#555;">${JSON.stringify(section.content)}</p>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Outfit',Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;background:#f9fafb;">
    <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="text-align:center;margin-bottom:24px;">
        <h1 style="color:#4A6B5A;font-size:24px;margin:0;">${report.title}</h1>
        <p style="color:#999;font-size:12px;margin:4px 0;">${report.tenantName} — ${new Date(report.generatedAt).toLocaleDateString()}</p>
      </div>
      ${sectionHtml}
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;text-align:center;">
        <p style="color:#999;font-size:11px;">Generated by Atheon Enterprise Intelligence Platform</p>
      </div>
    </div>
  </body></html>`;
}

/** Convert report data to CSV string */
export function reportToCsv(report: ReportData): string {
  const lines: string[] = [];
  lines.push(`# ${report.title}`);
  lines.push(`# Generated: ${report.generatedAt}`);
  lines.push(`# Tenant: ${report.tenantName}`);
  lines.push('');

  for (const section of report.sections) {
    lines.push(`## ${section.title}`);
    if (section.type === 'table' && Array.isArray(section.content) && section.content.length > 0) {
      const headers = Object.keys(section.content[0]);
      lines.push(headers.join(','));
      for (const row of section.content) {
        lines.push(headers.map(h => `"${String((row as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
      }
    } else {
      lines.push(String(section.content));
    }
    lines.push('');
  }

  return lines.join('\n');
}
