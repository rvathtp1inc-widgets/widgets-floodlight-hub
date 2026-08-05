CREATE TABLE IF NOT EXISTS access_users (
  id TEXT PRIMARY KEY,
  name TEXT,
  raw_json TEXT,
  last_seen_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_doors (
  id TEXT PRIMARY KEY,
  name TEXT,
  full_name TEXT,
  raw_json TEXT,
  last_seen_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS access_ingest_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_timestamp TIMESTAMP,
  last_event_id TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
