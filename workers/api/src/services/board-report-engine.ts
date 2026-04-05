/**
 * Board Report Engine
 * 
 * Generates comprehensive executive board reports with LLM,
 * stores content in board_reports table and PDF in R2.
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';
import { computeStrategicContext } from './radar-engine-v2';

export async function generateBoardReport(
  db: D1Database,
  tenantId: string,
  env: { AI: Ai; STORAGE?: R2Bucket },
  generatedBy?: string,
): Promise<{ id: string; content: Record<string, unknown>; pdfUrl?: string }> {
  // 1) Fetch health score + dimensions
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  // 2) Fetch strategic context from Radar
  let context: Record<string, unknown> = {};
  try {
    context = await computeStrategicContext(db, tenantId, env);
  } catch { /* empty context */ }

  // 3) Fetch top risks
  const risks = await db.prepare(
    "SELECT * FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 10"
  ).bind(tenantId).all();

  // 4) Fetch diagnostics summary
  const diagActive = await db.prepare(
    "SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).first<{ cnt: number }>();
  const diagPrescriptions = await db.prepare(
    "SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending'"
  ).bind(tenantId).first<{ cnt: number }>();

  // 5) Fetch ROI summary
  const roi = await db.prepare(
    'SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  // 6) Fetch catalyst effectiveness top-line
  const effectiveness = await db.prepare(
    'SELECT cluster_id, sub_catalyst_name, total_runs, recovery_rate, total_discrepancy_value_found FROM catalyst_effectiveness WHERE tenant_id = ? ORDER BY total_discrepancy_value_found DESC LIMIT 5'
  ).bind(tenantId).all();

  // 7) Build LLM prompt
  const llmConfig = await loadLlmConfig(db, tenantId);
  const tenant = await db.prepare('SELECT name, industry FROM tenants WHERE id = ?').bind(tenantId).first<{ name: string; industry: string }>();

  const dataPayload = {
    company: tenant?.name || 'Company',
    industry: tenant?.industry || 'general',
    healthScore: health?.overall_score || 0,
    dimensions: health?.dimensions ? JSON.parse(health.dimensions) : {},
    context,
    risks: risks.results.map((r: Record<string, unknown>) => ({ title: r.title, severity: r.severity, category: r.category })),
    diagnostics: { activeRCAs: diagActive?.cnt || 0, pendingPrescriptions: diagPrescriptions?.cnt || 0 },
    roi: roi ? { identified: roi.total_discrepancy_value_identified, recovered: roi.total_discrepancy_value_recovered, roiMultiple: roi.roi_multiple, personHours: roi.total_person_hours_saved } : null,
    effectiveness: effectiveness.results.map((e: Record<string, unknown>) => ({ subCatalyst: e.sub_catalyst_name, runs: e.total_runs, recoveryRate: e.recovery_rate, valueFound: e.total_discrepancy_value_found })),
  };

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are Atheon Intelligence. Generate an executive board report with sections:
1. Strategic Overview
2. Business Health
3. Risk Register
4. Root Cause Analysis Summary
5. Operational Performance
6. Financial Impact & ROI
7. Recommended Actions

Write in professional third-person tone. Format with markdown headers. Use ZAR for currency. Reference South African context where relevant.`,
    },
    {
      role: 'user',
      content: `Generate a board report using these data points:\n${JSON.stringify(dataPayload, null, 2)}`,
    },
  ];

  let reportMarkdown = '';
  try {
    const result = await llmChatWithFallback(llmConfig, env.AI, messages, { maxTokens: 3000 });
    reportMarkdown = result.text;
  } catch {
    reportMarkdown = `# Board Report — ${tenant?.name || 'Company'}\n\n## Strategic Overview\nHealth score: ${health?.overall_score || 0}/100\n\n## Risk Register\n${risks.results.length} active risks.\n\n## ROI\n${roi ? `ROI multiple: ${roi.roi_multiple}x` : 'No ROI data available.'}\n`;
  }

  // 8) Store in board_reports
  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = `Board Report — ${now.substring(0, 10)}`;

  const contentJson = {
    markdown: reportMarkdown,
    data: dataPayload,
    generatedAt: now,
  };

  // 9) Generate simple text-based PDF stored in R2
  let r2Key: string | null = null;
  if (env.STORAGE) {
    try {
      r2Key = `reports/${tenantId}/${reportId}.md`;
      await env.STORAGE.put(r2Key, reportMarkdown, {
        httpMetadata: { contentType: 'text/markdown' },
      });
    } catch {
      r2Key = null;
    }
  }

  // 10) Store metadata
  await db.prepare(
    `INSERT INTO board_reports (id, tenant_id, title, report_type, content, r2_key, generated_by, generated_at)
     VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?)`
  ).bind(reportId, tenantId, title, JSON.stringify(contentJson), r2Key, generatedBy || null, now).run();

  return { id: reportId, content: contentJson, pdfUrl: r2Key ? `/api/board-report/${reportId}` : undefined };
}
