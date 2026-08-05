ALTER TABLE event_routes RENAME TO event_routes_old;

CREATE TABLE event_routes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  event_class TEXT NOT NULL,
  upstream_event_type TEXT,
  object_types_json TEXT,
  binding_status TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  enabled INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

INSERT INTO event_routes (
  id,
  source_type,
  source_id,
  event_class,
  upstream_event_type,
  object_types_json,
  binding_status,
  target_type,
  target_id,
  enabled,
  notes
)
SELECT
  id,
  source_type,
  source_id,
  event_class,
  upstream_event_type,
  object_types_json,
  'resolved' AS binding_status,
  target_type,
  target_id,
  enabled,
  notes
FROM event_routes_old;

DROP TABLE event_routes_old;
