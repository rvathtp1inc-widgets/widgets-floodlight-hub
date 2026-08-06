CREATE TABLE semantic_condition_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semantic_condition_id INTEGER NOT NULL UNIQUE REFERENCES semantic_conditions(id),
  display_name TEXT NOT NULL,
  webhook_key TEXT NOT NULL UNIQUE,
  encrypted_shared_secret TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
