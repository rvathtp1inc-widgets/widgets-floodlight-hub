import type Database from 'better-sqlite3';
import { rawDb } from './client.js';

const REQUIRED_TABLE_COLUMNS: Record<string, string[]> = {
  floodlights: [
    'id',
    'name',
    'webhook_key',
    'shared_secret_encrypted',
    'shelly_host',
    'shelly_port',
    'relay_id',
    'auth_enabled',
    'shelly_password_encrypted',
    'automation_enabled',
    'manual_override_mode',
    'override_until',
    'test_mode_enabled',
    'test_mode_until',
    'schedule_mode',
    'schedule_json',
    'auto_off_seconds',
    'retrigger_mode',
    'debounce_seconds',
    'cooldown_seconds',
    'online_status',
    'last_seen_at',
    'last_known_output',
    'last_command_status',
    'notes',
    'created_at',
    'updated_at'
  ],
  groups: ['id', 'name', 'webhook_key', 'shared_secret_encrypted', 'test_mode_enabled', 'test_mode_until'],
  protect_sources: [
    'id',
    'protect_camera_id',
    'name',
    'model_key',
    'state',
    'supports_smart_detect',
    'supported_object_types_json',
    'enabled_object_types_json',
    'last_seen_at',
    'last_event_seen_at',
    'updated_at',
    'raw_json'
  ],
  access_users: [
    'id',
    'name',
    'raw_json',
    'last_seen_at'
  ],
  access_doors: [
    'id',
    'name',
    'full_name',
    'raw_json',
    'last_seen_at'
  ],
  access_ingest_state: [
    'id',
    'last_timestamp',
    'last_event_id',
    'updated_at'
  ],
  hub_settings: [
    'id',
    'timezone',
    'latitude',
    'longitude',
    'astro_enabled',
    'default_webhook_header_name',
    'protect_api_enabled',
    'protect_console_host',
    'protect_api_key_encrypted',
    'ui_session_timeout_minutes',
    'log_retention_days',
    'created_at',
    'updated_at'
  ],
  event_routes: [
    'id',
    'source_type',
    'source_id',
    'event_class',
    'upstream_event_type',
    'object_types_json',
    'binding_status',
    'target_type',
    'target_id',
    'enabled',
    'notes'
  ]
};

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function verifyRequiredSchema(db: Database.Database = rawDb): void {
  const missingByTable = Object.entries(REQUIRED_TABLE_COLUMNS)
    .map(([tableName, requiredColumns]) => {
      const actualColumns = getTableColumns(db, tableName);
      const missingColumns = requiredColumns.filter((columnName) => !actualColumns.has(columnName));
      return { tableName, missingColumns };
    })
    .filter((entry) => entry.missingColumns.length > 0);

  if (missingByTable.length === 0) {
    return;
  }

  const message = [
    'Database schema verification failed. Run "npm run db:migrate" and then "npm run db:verify".',
    ...missingByTable.map(
      (entry) => `- ${entry.tableName}: missing columns [${entry.missingColumns.join(', ')}]`
    )
  ].join('\n');

  throw new Error(message);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    verifyRequiredSchema();
    console.log('Schema verification passed.');
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
