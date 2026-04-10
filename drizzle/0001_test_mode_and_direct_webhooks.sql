ALTER TABLE floodlights ADD COLUMN webhook_key TEXT;
ALTER TABLE floodlights ADD COLUMN shared_secret_encrypted TEXT;
ALTER TABLE floodlights ADD COLUMN test_mode_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE floodlights ADD COLUMN test_mode_until TEXT;
ALTER TABLE floodlights ADD COLUMN schedule_mode TEXT NOT NULL DEFAULT 'always';
ALTER TABLE floodlights ADD COLUMN schedule_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE floodlights ADD COLUMN auto_off_seconds INTEGER NOT NULL DEFAULT 120;
ALTER TABLE floodlights ADD COLUMN retrigger_mode TEXT NOT NULL DEFAULT 'reset_full_duration';
ALTER TABLE floodlights ADD COLUMN debounce_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE floodlights ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE groups ADD COLUMN test_mode_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE groups ADD COLUMN test_mode_until TEXT;
