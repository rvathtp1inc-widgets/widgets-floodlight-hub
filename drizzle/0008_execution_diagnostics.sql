CREATE TABLE execution_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  diagnostic_type TEXT NOT NULL CHECK (diagnostic_type IN ('semantic_action', 'consumer_binding', 'semantic_aggregate')),
  sequence INTEGER NOT NULL,
  trace_id TEXT NOT NULL,
  ingress_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_event_type TEXT,
  source_event_class TEXT NOT NULL,
  route_id INTEGER,
  semantic_webhook_id INTEGER,
  webhook_key TEXT,
  semantic_condition_id INTEGER NOT NULL,
  semantic_condition_key TEXT,
  semantic_condition_label TEXT,
  requested_state TEXT NOT NULL CHECK (requested_state IN ('active', 'inactive')),
  lifecycle_intent TEXT NOT NULL CHECK (lifecycle_intent IN ('trigger', 'restore')),
  consumer_binding_id INTEGER,
  consumer_type TEXT,
  destination_summary_json TEXT,
  accepted INTEGER NOT NULL,
  changed INTEGER,
  delivered INTEGER,
  retained INTEGER,
  reason TEXT NOT NULL,
  binding_count INTEGER,
  successful_binding_count INTEGER,
  failed_binding_count INTEGER
);

CREATE INDEX execution_diagnostics_trace_id_idx
ON execution_diagnostics (trace_id, sequence, id);
