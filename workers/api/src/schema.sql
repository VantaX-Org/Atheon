
-- Run insights (LLM-generated narratives)
CREATE TABLE IF NOT EXISTS run_insights (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  summary TEXT,
  risks TEXT, -- JSON array
  actions TEXT, -- JSON array
  impact TEXT,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES sub_catalyst_runs(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_run_insights_run_id ON run_insights(run_id);
CREATE INDEX IF NOT EXISTS idx_run_insights_tenant_id ON run_insights(tenant_id);

-- Field-level transformations
CREATE TABLE IF NOT EXISTS field_transformations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  field_name TEXT NOT NULL,
  original_value TEXT,
  transformed_value TEXT,
  transformation_rule TEXT,
  confidence REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES sub_catalyst_runs(id),
  FOREIGN KEY (item_id) REFERENCES sub_catalyst_run_items(id)
);

CREATE INDEX IF NOT EXISTS idx_field_transformations_run_id ON field_transformations(run_id);
CREATE INDEX IF NOT EXISTS idx_field_transformations_item_id ON field_transformations(item_id);

-- Metric history for ML anomaly detection
CREATE TABLE IF NOT EXISTS process_metric_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  value REAL NOT NULL,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (metric_id) REFERENCES process_metrics(id)
);

CREATE INDEX IF NOT EXISTS idx_metric_history_tenant_metric ON process_metric_history(tenant_id, metric_id);
CREATE INDEX IF NOT EXISTS idx_metric_history_recorded_at ON process_metric_history(recorded_at);

-- Trigger to automatically save metric history
CREATE TRIGGER IF NOT EXISTS save_metric_history
AFTER UPDATE ON process_metrics
BEGIN
  INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
  VALUES (
    'mh_' || lower(hex(randomblob(16))),
    NEW.tenant_id,
    NEW.id,
    NEW.value,
    datetime('now')
  );
END;

-- Table for LLM-generated run insights
CREATE TABLE IF NOT EXISTS run_insights (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  summary TEXT,
  risks TEXT,  -- JSON array
  actions TEXT,  -- JSON array
  impact TEXT,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES sub_catalyst_runs(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_run_insights_run_id ON run_insights(run_id);
CREATE INDEX IF NOT EXISTS idx_run_insights_tenant_id ON run_insights(tenant_id);
CREATE INDEX IF NOT EXISTS idx_run_insights_generated_at ON run_insights(generated_at DESC);

-- Add field_transformations column to sub_catalyst_run_items if not exists
ALTER TABLE sub_catalyst_run_items ADD COLUMN field_transformations TEXT;

-- Add z_score and expected_mean to anomalies for ML detection
ALTER TABLE anomalies ADD COLUMN z_score REAL;
ALTER TABLE anomalies ADD COLUMN expected_mean REAL;
ALTER TABLE anomalies ADD COLUMN std_deviation REAL;
