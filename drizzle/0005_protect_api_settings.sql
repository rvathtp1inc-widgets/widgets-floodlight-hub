ALTER TABLE hub_settings ADD COLUMN protect_api_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hub_settings ADD COLUMN protect_console_host TEXT;
ALTER TABLE hub_settings ADD COLUMN protect_api_key_encrypted TEXT;
