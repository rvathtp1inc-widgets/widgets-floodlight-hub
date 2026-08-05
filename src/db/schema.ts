import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const floodlights = sqliteTable('floodlights', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  webhookKey: text('webhook_key'),
  sharedSecretEncrypted: text('shared_secret_encrypted'),
  shellyHost: text('shelly_host').notNull(),
  shellyPort: integer('shelly_port').notNull().default(80),
  relayId: integer('relay_id').notNull().default(0),
  authEnabled: integer('auth_enabled', { mode: 'boolean' }).notNull().default(false),
  shellyPasswordEncrypted: text('shelly_password_encrypted'),
  automationEnabled: integer('automation_enabled', { mode: 'boolean' }).notNull().default(true),
  manualOverrideMode: text('manual_override_mode').notNull().default('none'),
  overrideUntil: text('override_until'),
  testModeEnabled: integer('test_mode_enabled', { mode: 'boolean' }).notNull().default(false),
  testModeUntil: text('test_mode_until'),
  scheduleMode: text('schedule_mode').notNull().default('always'),
  scheduleJson: text('schedule_json').notNull().default('{}'),
  autoOffSeconds: integer('auto_off_seconds').notNull().default(120),
  retriggerMode: text('retrigger_mode').notNull().default('reset_full_duration'),
  debounceSeconds: integer('debounce_seconds').notNull().default(0),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  onlineStatus: text('online_status').notNull().default('unknown'),
  lastSeenAt: text('last_seen_at'),
  lastKnownOutput: integer('last_known_output', { mode: 'boolean' }),
  lastCommandStatus: text('last_command_status'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now)
});

export const groups = sqliteTable('groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  webhookKey: text('webhook_key').notNull().unique(),
  sharedSecretEncrypted: text('shared_secret_encrypted'),
  automationEnabled: integer('automation_enabled', { mode: 'boolean' }).notNull().default(true),
  testModeEnabled: integer('test_mode_enabled', { mode: 'boolean' }).notNull().default(false),
  testModeUntil: text('test_mode_until'),
  scheduleMode: text('schedule_mode').notNull().default('always'),
  scheduleJson: text('schedule_json').notNull().default('{}'),
  autoOffSeconds: integer('auto_off_seconds').notNull().default(120),
  retriggerMode: text('retrigger_mode').notNull().default('reset_full_duration'),
  debounceSeconds: integer('debounce_seconds').notNull().default(0),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(0),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now)
});

export const groupMemberships = sqliteTable('group_memberships', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull(),
  floodlightId: integer('floodlight_id').notNull(),
  createdAt: text('created_at').notNull().default(now)
});

export const activeTimers = sqliteTable('active_timers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  targetType: text('target_type').notNull(),
  targetId: integer('target_id').notNull(),
  startedAt: text('started_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  sourceEventId: integer('source_event_id'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now)
});

export const eventLogs = sqliteTable('event_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receivedAt: text('received_at').notNull().default(now),
  webhookKey: text('webhook_key').notNull(),
  targetType: text('target_type'),
  targetId: integer('target_id'),
  httpMethod: text('http_method').notNull(),
  remoteIp: text('remote_ip'),
  headerSummary: text('header_summary'),
  payloadRaw: text('payload_raw'),
  authResult: text('auth_result').notNull(),
  decision: text('decision').notNull(),
  decisionReason: text('decision_reason'),
  createdAt: text('created_at').notNull().default(now)
});

export const commandLogs = sqliteTable('command_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: text('created_at').notNull().default(now),
  floodlightId: integer('floodlight_id').notNull(),
  commandType: text('command_type').notNull(),
  requestSummary: text('request_summary'),
  responseSummary: text('response_summary'),
  success: integer('success', { mode: 'boolean' }).notNull(),
  errorText: text('error_text')
});

export const hubSettings = sqliteTable('hub_settings', {
  id: integer('id').primaryKey(),
  timezone: text('timezone').notNull().default('UTC'),
  latitude: text('latitude'),
  longitude: text('longitude'),
  astroEnabled: integer('astro_enabled', { mode: 'boolean' }).notNull().default(false),
  defaultWebhookHeaderName: text('default_webhook_header_name').notNull().default('X-Widgets-Secret'),
  protectApiEnabled: integer('protect_api_enabled', { mode: 'boolean' }).notNull().default(false),
  protectConsoleHost: text('protect_console_host'),
  protectApiKeyEncrypted: text('protect_api_key_encrypted'),
  uiSessionTimeoutMinutes: integer('ui_session_timeout_minutes').notNull().default(60),
  logRetentionDays: integer('log_retention_days').notNull().default(30),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now)
});

export const protectSources = sqliteTable('protect_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  protectCameraId: text('protect_camera_id').notNull().unique(),
  name: text('name').notNull(),
  modelKey: text('model_key').notNull(),
  state: text('state').notNull(),
  supportsSmartDetect: integer('supports_smart_detect', { mode: 'boolean' }).notNull().default(false),
  supportedObjectTypesJson: text('supported_object_types_json').notNull().default('[]'),
  enabledObjectTypesJson: text('enabled_object_types_json').notNull().default('[]'),
  lastSeenAt: text('last_seen_at').notNull(),
  lastEventSeenAt: text('last_event_seen_at'),
  updatedAt: text('updated_at').notNull().default(now),
  rawJson: text('raw_json')
});

export const accessUsers = sqliteTable('access_users', {
  id: text('id').primaryKey(),
  name: text('name'),
  rawJson: text('raw_json'),
  lastSeenAt: text('last_seen_at')
});

export const accessDoors = sqliteTable('access_doors', {
  id: text('id').primaryKey(),
  name: text('name'),
  fullName: text('full_name'),
  rawJson: text('raw_json'),
  lastSeenAt: text('last_seen_at')
});

export const accessIngestState = sqliteTable('access_ingest_state', {
  id: integer('id').primaryKey(),
  lastTimestamp: text('last_timestamp'),
  lastEventId: text('last_event_id'),
  updatedAt: text('updated_at').notNull().default(now)
});

export const eventRoutes = sqliteTable('event_routes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceType: text('source_type').notNull(),
  sourceId: integer('source_id').notNull(),
  eventClass: text('event_class').notNull(),
  upstreamEventType: text('upstream_event_type'),
  objectTypesJson: text('object_types_json'),
  bindingStatus: text('binding_status').notNull(),
  targetType: text('target_type'),
  targetId: integer('target_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes')
});
