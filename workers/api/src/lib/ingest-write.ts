// src/lib/ingest-write.ts
// Failure-safe validate→write for uploaded prospect data. Both the authenticated
// assessment-dataset route and the public trial funnel call this. It owns the
// erp_* DELETE+INSERT only — the CALLER writes the assessment_datasets status row
// (and marks it 'failed' when errors are returned OR when this throws).
import { INGEST_MANIFEST } from './ingest-manifest';
import { validateDomainRows } from './ingest-validate';

type Domains = Record<string, { header: string[]; rows: Array<Record<string, unknown>> }>;
type IngestError = { domain: string; row: number; column: string; message: string };

export async function ingestDomains(
  db: D1Database,
  tenantId: string,
  datasetId: string,
  domains: Domains,
  opts: { maxRowsPerDomain: number },
): Promise<{ row_counts: Record<string, number>; errors: IngestError[] }> {
  const validated: Record<string, Array<Record<string, unknown>>> = {};
  const errors: IngestError[] = [];

  for (const [domain, payload] of Object.entries(domains)) {
    const def = INGEST_MANIFEST.find(d => d.domain === domain);
    if (!def) { errors.push({ domain, row: 0, column: '', message: `unknown domain ${domain}` }); continue; }

    const rowsIn = payload.rows || [];
    if (rowsIn.length > opts.maxRowsPerDomain) {
      errors.push({ domain, row: 0, column: '', message: `too many rows: ${rowsIn.length} exceeds cap ${opts.maxRowsPerDomain}` });
      continue;
    }

    const { rows, errors: cellErrors } = validateDomainRows(domain, payload.header || [], rowsIn);
    if (cellErrors.length) { for (const e of cellErrors) errors.push({ domain, ...e }); }
    else validated[domain] = rows;
  }

  // Validate-all-then-write: any error and nothing is written.
  if (errors.length) return { row_counts: {}, errors: errors.slice(0, 200) };

  const rowCounts: Record<string, number> = {};
  const stmts: D1PreparedStatement[] = [];
  for (const [domain, rows] of Object.entries(validated)) {
    const def = INGEST_MANIFEST.find(d => d.domain === domain)!;
    stmts.push(db.prepare(`DELETE FROM ${def.table} WHERE tenant_id = ? AND dataset_id = ?`).bind(tenantId, datasetId));
    let n = 0;
    for (const row of rows) {
      // Only emit columns we actually have a value for. erp_* tables carry
      // NOT NULL DEFAULT constraints on several numeric/status fields, so
      // inserting an explicit NULL for an absent optional column violates the
      // constraint — omit it and let the DB default apply instead.
      const dataCols = def.columns.filter(col => row[col.name] != null);
      const cols = ['id', 'tenant_id', 'dataset_id', 'source_system', ...dataCols.map(col => col.name)];
      const vals = [`${datasetId}_${domain}_${n}`, tenantId, datasetId, 'upload', ...dataCols.map(col => row[col.name])];
      const placeholders = cols.map(() => '?').join(', ');
      stmts.push(db.prepare(`INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals));
      n++;
    }
    rowCounts[domain] = n;
  }

  // The DELETE+INSERT spans multiple batch() calls (50/batch) so it is NOT
  // atomic. A mid-batch throw propagates to the CALLER, which marks the dataset
  // 'failed' — it can never be left neither ready nor failed.
  // ponytail: no try/catch here — a bare rethrow is a no-op; the caller owns recovery.
  for (let i = 0; i < stmts.length; i += 50) {
    await db.batch(stmts.slice(i, i + 50));
  }

  return { row_counts: rowCounts, errors: [] };
}
