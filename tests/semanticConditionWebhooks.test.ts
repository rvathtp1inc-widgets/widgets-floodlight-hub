import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-webhooks-'));
const dbPath = path.join(tempDirectory, 'test.db');
const sqlite = new Database(dbPath);
for (const migration of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join('drizzle', migration), 'utf8'));
  if (migration === '0000_init.sql') sqlite.prepare("INSERT INTO groups (name, webhook_key) VALUES ('Preserved Group', 'preserved')").run();
}
sqlite.close();
process.env.DB_PATH = dbPath;
process.env.ACCESS_ENABLED = 'false';
process.env.FLOODLIGHT_HUB_CONFIG_PATH = path.join(tempDirectory, 'not-provisioned.json');

const { buildApp } = await import('../src/app.js');
const { rawDb } = await import('../src/db/client.js');
const { verifyRequiredSchema } = await import('../src/db/verifySchema.js');
const { decryptString } = await import('../src/lib/secrets.js');
const { handleSemanticWebhook } = await import('../src/services/webhooks/semanticWebhookService.js');
const { IngressEventDispatcher } = await import('../src/services/ingress/ingressEventDispatcher.js');
const { SemanticWebhookTimerManager } = await import('../src/services/webhooks/semanticWebhookTimerManager.js');
const noopTimerManager = new SemanticWebhookTimerManager(async () => undefined);

test.after(() => {
  rawDb.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('0007 schema verifies and enforces webhook foreign key and uniqueness without data loss', () => {
  verifyRequiredSchema();
  assert.equal((rawDb.prepare("SELECT name FROM groups WHERE webhook_key = 'preserved'").get() as { name: string }).name, 'Preserved Group');
  const columns = rawDb.prepare('PRAGMA table_info(semantic_condition_webhooks)').all() as Array<{ name: string; dflt_value: string | null }>;
  assert.equal(columns.find((column) => column.name === 'enabled')?.dflt_value, '1');
  assert.match(columns.find((column) => column.name === 'created_at')?.dflt_value ?? '', /strftime/);
  assert.throws(() => rawDb.prepare("INSERT INTO semantic_condition_webhooks (semantic_condition_id,display_name,webhook_key) VALUES (999,'Missing','missing')").run());
  const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('schema.webhook','Schema Webhook') RETURNING id").get() as { id: number };
  rawDb.prepare("INSERT INTO semantic_condition_webhooks (semantic_condition_id,display_name,webhook_key) VALUES (?,'First','schema-first')").run(condition.id);
  assert.throws(() => rawDb.prepare("INSERT INTO semantic_condition_webhooks (semantic_condition_id,display_name,webhook_key) VALUES (?,'Second','schema-second')").run(condition.id));
  const other = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('schema.other','Other') RETURNING id").get() as { id: number };
  assert.throws(() => rawDb.prepare("INSERT INTO semantic_condition_webhooks (semantic_condition_id,display_name,webhook_key) VALUES (?,'Other','schema-first')").run(other.id));
});

test('management API validates, defaults, encrypts, preserves, clears, and restricts deletion', async () => {
  const app = buildApp();
  const condition = (await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'front.yard.person', label: 'Front Yard Person' } })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: 999, webhookKey: 'missing' } })).statusCode, 400);
  const createdResponse = await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: condition.id, webhookKey: 'front-yard-person', sharedSecret: 'secret-value' } });
  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.json();
  assert.equal(created.displayName, 'Front Yard Person');
  assert.equal(created.hasSharedSecret, true);
  assert.equal(created.configured, true);
  assert.equal(created.authenticationHeaderName, 'X-Widgets-Secret');
  assert.equal(created.restoreMode, 'explicit_inactive');
  assert.equal(created.autoRestoreSeconds, null);
  assert.equal('sharedSecret' in created, false);
  assert.equal('encryptedSharedSecret' in created, false);
  const stored = rawDb.prepare('SELECT encrypted_shared_secret FROM semantic_condition_webhooks WHERE id = ?').get(created.id) as { encrypted_shared_secret: string };
  assert.notEqual(stored.encrypted_shared_secret, 'secret-value');
  assert.equal(decryptString(stored.encrypted_shared_secret), 'secret-value');
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: condition.id, webhookKey: 'duplicate-condition' } })).statusCode, 409);
  const condition2 = (await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'front.yard.vehicle', label: 'Vehicle' } })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: condition2.id, webhookKey: 'front-yard-person' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/semantic-conditions/${condition.id}` })).statusCode, 409);

  const omitted = (await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${created.id}`, payload: { displayName: 'Updated' } })).json();
  assert.equal(omitted.displayName, 'Updated');
  assert.equal(decryptString((rawDb.prepare('SELECT encrypted_shared_secret FROM semantic_condition_webhooks WHERE id = ?').get(created.id) as { encrypted_shared_secret: string }).encrypted_shared_secret), 'secret-value');
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${created.id}`, payload: { sharedSecret: '   ', enabled: false } });
  assert.equal(decryptString((rawDb.prepare('SELECT encrypted_shared_secret FROM semantic_condition_webhooks WHERE id = ?').get(created.id) as { encrypted_shared_secret: string }).encrypted_shared_secret), 'secret-value');
  const cleared = (await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${created.id}`, payload: { clearSharedSecret: true } })).json();
  assert.equal(cleared.hasSharedSecret, false);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/semantic-webhooks/${created.id}` })).statusCode, 200);
  assert.ok(rawDb.prepare('SELECT 1 FROM semantic_conditions WHERE id = ?').get(condition.id));
  await app.close();
});

test('auto-restore management validation accepts only the approved timeout contract', async () => {
  const app = buildApp();
  let sequence = 0;
  const create = async (autoRestoreSeconds: unknown, suffix = '') => {
    sequence += 1;
    const condition = (await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: `timeout.${sequence}`, label: `Timeout ${sequence}` } })).json();
    return app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: {
      semanticConditionId: condition.id, webhookKey: `timeout-${sequence}${suffix}`,
      restoreMode: 'auto_timeout', ...(autoRestoreSeconds === undefined ? {} : { autoRestoreSeconds })
    } });
  };
  assert.equal((await create(undefined)).json().error, 'auto_restore_seconds_required');
  assert.equal((await create(1.5)).json().error, 'invalid_auto_restore_seconds');
  assert.equal((await create(0)).json().error, 'invalid_auto_restore_seconds');
  assert.equal((await create(86_401)).json().error, 'invalid_auto_restore_seconds');
  const minimum = await create(1);
  assert.equal(minimum.statusCode, 201);
  assert.deepEqual({ restoreMode: minimum.json().restoreMode, autoRestoreSeconds: minimum.json().autoRestoreSeconds }, { restoreMode: 'auto_timeout', autoRestoreSeconds: 1 });
  const maximum = await create(86_400);
  assert.equal(maximum.statusCode, 201);
  assert.equal(maximum.json().autoRestoreSeconds, 86_400);
  await app.close();
});

test('public semantic endpoints reject safely and publish authenticated active/inactive envelopes', async () => {
  const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('public.semantic','Public Semantic') RETURNING id").get() as { id: number };
  const app = buildApp();
  const webhook = (await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: condition.id, webhookKey: 'public-semantic', sharedSecret: 'correct' } })).json();
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/unknown/active' })).json().reason, 'webhook_not_found');
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active' })).json().reason, 'invalid_secret');
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active', headers: { 'x-widgets-secret': 'wrong' } })).json().reason, 'invalid_secret');
  assert.equal((rawDb.prepare("SELECT count(*) AS total FROM execution_diagnostics WHERE webhook_key = 'public-semantic'").get() as { total: number }).total, 0);
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${webhook.id}`, payload: { enabled: false } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active', headers: { 'x-widgets-secret': 'correct' } })).json().reason, 'webhook_disabled');
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${webhook.id}`, payload: { enabled: true } });
  await app.inject({ method: 'PATCH', url: `/api/semantic-conditions/${condition.id}`, payload: { enabled: false } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active', headers: { 'x-widgets-secret': 'correct' } })).json().reason, 'semantic_condition_disabled');
  await app.inject({ method: 'PATCH', url: `/api/semantic-conditions/${condition.id}`, payload: { enabled: true } });
  const active = await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active', headers: { 'x-widgets-secret': 'correct' }, payload: { requestedState: 'inactive', secret: 'ignored' } });
  assert.equal(active.statusCode, 200);
  assert.deepEqual({ requestedState: active.json().requestedState, lifecycleIntent: active.json().lifecycleIntent }, { requestedState: 'active', lifecycleIntent: 'trigger' });
  const activeDiagnostic = rawDb.prepare("SELECT state_origin, timer_expired FROM execution_diagnostics WHERE trace_id = ? AND diagnostic_type = 'semantic_action'").get(active.json().traceId) as { state_origin: string; timer_expired: number };
  assert.deepEqual(activeDiagnostic, { state_origin: 'explicit_active', timer_expired: 0 });
  const inactive = await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/inactive', headers: { 'x-widgets-secret': 'correct' }, payload: { requestedState: 'active' } });
  assert.equal(inactive.statusCode, 200);
  assert.deepEqual({ requestedState: inactive.json().requestedState, lifecycleIntent: inactive.json().lifecycleIntent }, { requestedState: 'inactive', lifecycleIntent: 'restore' });
  const inactiveDiagnostic = rawDb.prepare("SELECT state_origin, timer_expired FROM execution_diagnostics WHERE trace_id = ? AND diagnostic_type = 'semantic_action'").get(inactive.json().traceId) as { state_origin: string; timer_expired: number };
  assert.deepEqual(inactiveDiagnostic, { state_origin: 'explicit_inactive', timer_expired: 0 });
  assert.ok(active.json().traceId);
  const log = rawDb.prepare("SELECT auth_result, decision FROM event_logs WHERE webhook_key = 'public-semantic' ORDER BY id DESC LIMIT 1").get() as { auth_result: string; decision: string };
  assert.deepEqual(log, { auth_result: 'valid', decision: 'accepted' });
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${webhook.id}`, payload: { clearSharedSecret: true } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/webhooks/semantic/public-semantic/active', headers: { 'x-widgets-secret': 'correct' } })).json().reason, 'invalid_secret');
  await app.close();
});

test('orphaned semantic webhook fixture is rejected without dispatcher publication', async () => {
  const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('orphan.semantic','Orphan') RETURNING id").get() as { id: number };
  const encrypted = (await import('../src/lib/secrets.js')).encryptString('orphan-secret');
  rawDb.prepare("INSERT INTO semantic_condition_webhooks (semantic_condition_id,display_name,webhook_key,encrypted_shared_secret) VALUES (?,'Orphan','orphan-semantic',?)").run(condition.id, encrypted);
  rawDb.pragma('foreign_keys = OFF');
  rawDb.prepare('DELETE FROM semantic_conditions WHERE id = ?').run(condition.id);
  rawDb.pragma('foreign_keys = ON');
  const dispatcher = new IngressEventDispatcher();
  let publications = 0;
  dispatcher.subscribe(() => { publications += 1; });
  const result = await handleSemanticWebhook({
    webhookKey: 'orphan-semantic', requestedState: 'active', method: 'POST',
    headers: { 'x-widgets-secret': 'orphan-secret' },
    logger: { warn: () => undefined, info: () => undefined } as never,
    ingressEventDispatcher: dispatcher, timerManager: noopTimerManager
  });
  assert.equal(result.body.reason, 'semantic_condition_not_found');
  assert.equal(publications, 0);
});

test('rejected semantic requests do not publish to the dispatcher', async () => {
  const dispatcher = new IngressEventDispatcher();
  let publications = 0;
  dispatcher.subscribe(() => { publications += 1; });
  const logger = { warn: () => undefined, info: () => undefined } as never;
  await handleSemanticWebhook({ webhookKey: 'does-not-exist', requestedState: 'active', method: 'POST', headers: {}, logger, ingressEventDispatcher: dispatcher, timerManager: noopTimerManager });
  assert.equal(publications, 0);
});

test('ingress conflicts are limited to enabled resolved routes targeting the same semantic condition', async () => {
  const app = buildApp();
  rawDb.prepare(`INSERT INTO protect_sources (protect_camera_id,name,model_key,state,last_seen_at)
    VALUES ('conflict-camera','Conflict Camera','camera','CONNECTED','2026-08-06T00:00:00Z')`).run();
  const sourceId = (rawDb.prepare("SELECT id FROM protect_sources WHERE protect_camera_id = 'conflict-camera'").get() as { id: number }).id;
  rawDb.prepare("INSERT INTO floodlights (name,shelly_host) VALUES ('Conflict Light','127.0.0.1')").run();
  const floodlightId = Number(rawDb.prepare("SELECT id FROM floodlights WHERE name = 'Conflict Light'").pluck().get());
  let sequence = 0;
  const condition = async () => {
    sequence += 1;
    return (await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: `conflict.${sequence}`, label: `Conflict ${sequence}` } })).json();
  };
  const route = (targetId: number, overrides: Record<string, unknown> = {}) => ({
    sourceType: 'protect_source', sourceId, eventClass: 'zone', upstreamEventType: 'smartDetectZone',
    objectTypes: ['person'], bindingStatus: 'resolved', targetType: 'semantic_condition', targetId, enabled: true,
    ...overrides
  });
  const conflictShape = { error: 'semantic_condition_ingress_conflict', code: 'semantic_condition_ingress_conflict', message: 'This Condition is already controlled by another Automation or Semantic Webhook.' };

  const routed = await condition();
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route(routed.id) })).statusCode, 200);
  const webhookConflict = await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: routed.id, webhookKey: 'route-controlled' } });
  assert.equal(webhookConflict.statusCode, 409);
  assert.deepEqual(webhookConflict.json(), conflictShape);
  const disabledWebhook = await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: routed.id, webhookKey: 'route-controlled-disabled', enabled: false } });
  assert.equal(disabledWebhook.statusCode, 201);
  const enableConflict = await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${disabledWebhook.json().id}`, payload: { enabled: true } });
  assert.equal(enableConflict.statusCode, 409);
  assert.deepEqual(enableConflict.json(), conflictShape);

  const webhookControlled = await condition();
  const webhook = await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: webhookControlled.id, webhookKey: 'webhook-controlled', enabled: true } });
  assert.equal(webhook.statusCode, 201);
  const routeConflict = await app.inject({ method: 'POST', url: '/api/routes', payload: route(webhookControlled.id) });
  assert.equal(routeConflict.statusCode, 409);
  assert.deepEqual(routeConflict.json(), conflictShape);
  const disabledRoute = await app.inject({ method: 'POST', url: '/api/routes', payload: route(webhookControlled.id, { enabled: false }) });
  assert.equal(disabledRoute.statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/routes/${disabledRoute.json().id}`, payload: { enabled: true } })).statusCode, 409);
  const unresolvedRoute = await app.inject({ method: 'POST', url: '/api/routes', payload: route(webhookControlled.id, { bindingStatus: 'unresolved', enabled: true }) });
  assert.equal(unresolvedRoute.statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/routes/${unresolvedRoute.json().id}`, payload: { bindingStatus: 'resolved' } })).statusCode, 409);

  const unrelated = await condition();
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route(unrelated.id) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route(floodlightId, { targetType: 'floodlight' }) })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route(1, { targetType: 'group' }) })).statusCode, 200);

  const disabledWebhookCondition = await condition();
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-webhooks', payload: { semanticConditionId: disabledWebhookCondition.id, webhookKey: 'disabled-webhook', enabled: false } })).statusCode, 201);
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route(disabledWebhookCondition.id) })).statusCode, 200);
  await app.close();
});
