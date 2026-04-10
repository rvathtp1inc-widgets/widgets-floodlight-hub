CREATE TABLE IF NOT EXISTS floodlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  shelly_host TEXT NOT NULL,
  shelly_port INTEGER NOT NULL DEFAULT 80,
  relay_id INTEGER NOT NULL DEFAULT 0,
  webhook_key TEXT UNIQUE,
  shared_secret_encrypted TEXT,
  auth_enabled INTEGER NOT NULL DEFAULT 0,
  shelly_password_encrypted TEXT,
  automation_enabled INTEGER NOT NULL DEFAULT 1,
  test_mode_enabled INTEGER NOT NULL DEFAULT 0,
  test_mode_until TEXT,
  schedule_mode TEXT NOT NULL DEFAULT 'always',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  auto_off_seconds INTEGER NOT NULL DEFAULT 120,
  retrigger_mode TEXT NOT NULL DEFAULT 'reset_full_duration',
  debounce_seconds INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  manual_override_mode TEXT NOT NULL DEFAULT 'none',
  override_until TEXT,
  online_status TEXT NOT NULL DEFAULT 'unknown',
  last_seen_at TEXT,
  last_known_output INTEGER,
  last_command_status TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  webhook_key TEXT NOT NULL UNIQUE,
  shared_secret_encrypted TEXT,
  automation_enabled INTEGER NOT NULL DEFAULT 1,
  test_mode_enabled INTEGER NOT NULL DEFAULT 0,
  test_mode_until TEXT,
  schedule_mode TEXT NOT NULL DEFAULT 'always',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  auto_off_seconds INTEGER NOT NULL DEFAULT 120,
  retrigger_mode TEXT NOT NULL DEFAULT 'reset_full_duration',
  debounce_seconds INTEGER NOT NULL DEFAULT 0,
  cooldown_seconds INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS group_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  floodlight_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(group_id, floodlight_id)
);

CREATE TABLE IF NOT EXISTS active_timers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  source_event_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS event_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  webhook_key TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  http_method TEXT NOT NULL,
  remote_ip TEXT,
  header_summary TEXT,
  payload_raw TEXT,
  auth_result TEXT NOT NULL,
  decision TEXT NOT NULL,
  decision_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS command_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  floodlight_id INTEGER NOT NULL,
  command_type TEXT NOT NULL,
  request_summary TEXT,
  response_summary TEXT,
  success INTEGER NOT NULL,
  error_text TEXT
);

CREATE TABLE IF NOT EXISTS hub_settings (
  id INTEGER PRIMARY KEY,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  latitude TEXT,
  longitude TEXT,
  astro_enabled INTEGER NOT NULL DEFAULT 0,
  default_webhook_header_name TEXT NOT NULL DEFAULT 'X-Widgets-Secret',
  ui_session_timeout_minutes INTEGER NOT NULL DEFAULT 60,
  log_retention_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
