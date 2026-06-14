-- Migration 0006: User preferences (notification settings persistence)
-- Profile name/email already live on the users table; this stores per-user
-- notification toggles that the Settings page previously dropped on reload.
-- Created with IF NOT EXISTS so the endpoint can also self-heal at runtime
-- (same pattern as the inline-middleware tables folded into 0003).
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  notification_prefs TEXT NOT NULL DEFAULT '{}',  -- JSON: { <prefKey>: boolean }
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
