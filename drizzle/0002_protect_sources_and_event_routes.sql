CREATE TABLE IF NOT EXISTS protect_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  protect_camera_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  model_key TEXT NOT NULL,
  state TEXT NOT NULL,
  supports_smart_detect INTEGER NOT NULL DEFAULT 0,
  supported_object_types_json TEXT NOT NULL DEFAULT '[]',
  enabled_object_types_json TEXT NOT NULL DEFAULT '[]',
  last_seen_at TEXT NOT NULL,
  last_event_seen_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  raw_json TEXT
);

CREATE TABLE IF NOT EXISTS event_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  event_class TEXT NOT NULL,
  upstream_event_type TEXT,
  object_types_json TEXT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);
