CREATE TABLE semantic_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semantic_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  restore_policy TEXT NOT NULL DEFAULT 'source_lifecycle' CHECK (restore_policy = 'source_lifecycle'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE consumer_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  semantic_condition_id INTEGER NOT NULL REFERENCES semantic_conditions(id),
  consumer_type TEXT NOT NULL CHECK (consumer_type = 'virtual_security_panel'),
  binding_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (semantic_condition_id, consumer_type, binding_json)
);

CREATE UNIQUE INDEX consumer_bindings_enabled_panel_zone_unique
ON consumer_bindings (
  consumer_type,
  json_extract(binding_json, '$.panelKey'),
  json_extract(binding_json, '$.zoneNumber')
)
WHERE enabled = 1;

CREATE UNIQUE INDEX event_routes_enabled_semantic_condition_unique
ON event_routes (target_id)
WHERE target_type = 'semantic_condition'
  AND enabled = 1
  AND binding_status = 'resolved';
