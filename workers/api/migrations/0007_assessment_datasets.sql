-- Migration 0007: Per-assessment uploaded dataset.
-- Exactly one dataset per assessment. Holds ingest status + per-domain row
-- counts so the wizard can gate the run on status='ready'. ERP rows tagged
-- with this dataset's id live in the erp_* tables (dataset_id column, added
-- via self-heal in migrate.ts). NULL dataset_id on erp_* = existing tenant/seed
-- data and keeps every current query + the demo seed working untouched.
CREATE TABLE IF NOT EXISTS assessment_datasets (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'ingesting' | 'ready' | 'failed'
  row_counts TEXT NOT NULL DEFAULT '{}',   -- JSON: { <domain>: number }
  error TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_datasets_assessment ON assessment_datasets(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_datasets_tenant ON assessment_datasets(tenant_id);
