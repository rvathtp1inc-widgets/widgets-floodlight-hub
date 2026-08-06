ALTER TABLE semantic_condition_webhooks
ADD COLUMN restore_mode TEXT NOT NULL DEFAULT 'explicit_inactive'
CHECK (restore_mode IN ('explicit_inactive', 'auto_timeout'));

ALTER TABLE semantic_condition_webhooks
ADD COLUMN auto_restore_seconds INTEGER;

ALTER TABLE execution_diagnostics
ADD COLUMN state_origin TEXT;

ALTER TABLE execution_diagnostics
ADD COLUMN timer_expired INTEGER;

ALTER TABLE execution_diagnostics
ADD COLUMN auto_restore_seconds INTEGER;
