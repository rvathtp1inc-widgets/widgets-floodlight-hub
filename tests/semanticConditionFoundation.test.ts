import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-foundation-'));
const dbPath = path.join(tempDirectory, 'test.db');
const sqlite = new Database(dbPath);
for (const migration of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) {
  sqlite.exec(fs.readFileSync(path.join('drizzle', migration), 'utf8'));
  if (migration === '0000_init.sql') {
    sqlite.prepare("INSERT INTO groups (name, webhook_key) VALUES ('Preserved Group', 'preserved')").run();
  }
}
sqlite.close();
process.env.DB_PATH = dbPath;
process.env.ACCESS_ENABLED = 'false';
process.env.FLOODLIGHT_HUB_CONFIG_PATH = path.join(tempDirectory, 'not-provisioned.json');

const { buildApp } = await import('../src/app.js');
const { rawDb } = await import('../src/db/client.js');
const { verifyRequiredSchema } = await import('../src/db/verifySchema.js');
const { executeSemanticConditionRoute } = await import('../src/services/execution/semanticConditionExecutionService.js');

test.after(async () => {
  rawDb.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('migration schema verifies, enforces foreign keys, and omits timeout restore', () => {
  verifyRequiredSchema();
  assert.equal((rawDb.prepare("SELECT name FROM groups WHERE webhook_key = 'preserved'").get() as { name: string }).name, 'Preserved Group');
  assert.equal(rawDb.pragma('foreign_keys', { simple: true }), 1);
  const columns = rawDb.prepare('PRAGMA table_info(semantic_conditions)').all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name === 'restore_timeout_ms'), false);
  assert.throws(() => rawDb.prepare(`INSERT INTO consumer_bindings
    (semantic_condition_id, consumer_type, binding_json) VALUES (999, 'virtual_security_panel', '{"panelKey":"default","zoneNumber":1}')`).run());
});

test('semantic condition and consumer binding CRUD validation and restrictions', async () => {
  const app = buildApp();
  const created = await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'protect.frontyard.person', label: 'Front Yard Person' } });
  assert.equal(created.statusCode, 201);
  const condition = created.json();
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'protect.frontyard.person', label: 'Duplicate' } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'Bad Key', label: 'Bad' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/semantic-conditions/${condition.id}`, payload: { semanticKey: 'changed' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/semantic-conditions/${condition.id}`, payload: { label: 'Updated', enabled: false } })).statusCode, 200);

  for (const binding of [
    {},
    { panelKey: 'other', zoneNumber: 1 },
    { panelKey: 'default', zoneNumber: 0 },
    { panelKey: 'default', zoneNumber: 209 },
    { panelKey: 'default', zoneNumber: 1.5 }
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/consumer-bindings', payload: { semanticConditionId: condition.id, consumerType: 'virtual_security_panel', binding } });
    assert.equal(response.statusCode, 400);
  }
  const bindingCreated = await app.inject({ method: 'POST', url: '/api/consumer-bindings', payload: {
    semanticConditionId: condition.id,
    consumerType: 'virtual_security_panel',
    binding: { zoneNumber: 4, ignored: 'discarded', panelKey: 'default' }
  } });
  assert.equal(bindingCreated.statusCode, 201);
  const binding = bindingCreated.json();
  assert.deepEqual(binding.binding, { panelKey: 'default', zoneNumber: 4 });
  const stored = rawDb.prepare('SELECT binding_json FROM consumer_bindings WHERE id = ?').get(binding.id) as { binding_json: string };
  assert.equal(stored.binding_json, '{"panelKey":"default","zoneNumber":4}');
  assert.equal((await app.inject({ method: 'POST', url: '/api/consumer-bindings', payload: { semanticConditionId: condition.id, consumerType: 'virtual_security_panel', binding: { panelKey: 'default', zoneNumber: 4 } } })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/consumer-bindings/${binding.id}`, payload: { semanticConditionId: 2 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/consumer-bindings/${binding.id}`, payload: { consumerType: 'x' } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/semantic-conditions/${condition.id}` })).statusCode, 409);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/consumer-bindings/${binding.id}` })).statusCode, 200);
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/semantic-conditions/${condition.id}` })).statusCode, 200);
  await app.close();
});

test('semantic event route uniqueness is validated and constrained', async () => {
  const app = buildApp();
  const condition = (await app.inject({ method: 'POST', url: '/api/semantic-conditions', payload: { semanticKey: 'protect.driveway.person', label: 'Driveway' } })).json();
  rawDb.prepare(`INSERT INTO protect_sources
    (protect_camera_id,name,model_key,state,last_seen_at) VALUES ('camera-test','Camera','camera','CONNECTED','2026-01-01T00:00:00Z')`).run();
  const source = rawDb.prepare("SELECT id FROM protect_sources WHERE protect_camera_id = 'camera-test'").get() as { id: number };
  const route = { sourceType: 'protect_source', sourceId: source.id, eventClass: 'zone', upstreamEventType: 'smartDetectZone', objectTypes: ['person'], bindingStatus: 'resolved', targetType: 'semantic_condition', targetId: condition.id, enabled: true };
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/routes', payload: route })).statusCode, 409);
  const disabled = await app.inject({ method: 'POST', url: '/api/routes', payload: { ...route, enabled: false } });
  assert.equal(disabled.statusCode, 200);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/routes/${disabled.json().id}`, payload: { enabled: true } })).statusCode, 409);
  assert.throws(() => rawDb.prepare(`INSERT INTO event_routes
    (source_type,source_id,event_class,binding_status,target_type,target_id,enabled)
    VALUES ('protect_source',?,'zone','resolved','semantic_condition',?,1)`).run(source.id, condition.id));
  await app.close();
});

test('semantic binding expansion is sequential by ID and continues after failure without retry', async () => {
  const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('sequence.test','Sequence') RETURNING id").get() as { id: number };
  const insert = rawDb.prepare("INSERT INTO consumer_bindings (semantic_condition_id,consumer_type,binding_json) VALUES (?,'virtual_security_panel',?)");
  const firstId = Number(insert.run(condition.id, '{"panelKey":"default","zoneNumber":12}').lastInsertRowid);
  const secondId = Number(insert.run(condition.id, '{"panelKey":"default","zoneNumber":128}').lastInsertRowid);
  const attempts: Array<{ bindingId: number; desiredState: string; lifecycleIntent: string }> = [];
  const logger = { info: () => undefined, error: () => undefined } as never;
  const result = await executeSemanticConditionRoute({
    routeId: 77,
    semanticConditionId: condition.id,
    lifecycleIntent: 'restore',
    desiredState: 'inactive',
    logger,
    event: {
      source: 'protect_api', ingressType: 'api', timestamp: '2026-01-01T00:00:00Z', eventId: 'event-1',
      eventType: 'smartDetectZone', eventClass: 'zone', cameraId: 'camera', objectTypes: ['person'],
      userId: null, userName: null, doorId: null, doorName: null, credentialProvider: null, result: null,
      raw: {}, diagnosticsOnly: true
    },
    consumer: async (action) => {
      attempts.push({ bindingId: action.bindingId, desiredState: action.desiredState, lifecycleIntent: action.lifecycleIntent });
      if (action.bindingId === firstId) throw new Error('planned failure');
      return {
        accepted: true, delivered: false, reason: 'diagnostics_stub_planned_not_delivered',
        consumerType: 'virtual_security_panel', bindingId: action.bindingId,
        semanticConditionId: action.semanticCondition.id, semanticKey: action.semanticCondition.semanticKey,
        desiredState: action.desiredState, mappedConsumerState: 'Normal', panelKey: 'default',
        zoneNumber: action.binding.zoneNumber, traceId: action.traceId
      };
    }
  });
  assert.deepEqual(attempts, [
    { bindingId: firstId, desiredState: 'inactive', lifecycleIntent: 'restore' },
    { bindingId: secondId, desiredState: 'inactive', lifecycleIntent: 'restore' }
  ]);
  assert.equal(result.results.length, 2);
});
