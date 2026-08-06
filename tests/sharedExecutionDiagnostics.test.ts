import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-execution-diagnostics-'));
const dbPath = path.join(tempDirectory, 'test.db');
const sqlite = new Database(dbPath);
for (const migration of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join('drizzle', migration), 'utf8'));
sqlite.close();
process.env.DB_PATH = dbPath;
process.env.ACCESS_ENABLED = 'false';
process.env.FLOODLIGHT_HUB_CONFIG_PATH = path.join(tempDirectory, 'not-provisioned.json');

const { rawDb } = await import('../src/db/client.js');
const { executeSemanticConditionRoute } = await import('../src/services/execution/semanticConditionExecutionService.js');
const { registerExecutionPlannerSubscriber, registerSemanticActionPlannerSubscriber } = await import('../src/services/execution/executionPlannerSubscriber.js');
const { registerLifecycleExecutionGate } = await import('../src/services/execution/lifecycleExecutionGate.js');
const { IngressEventDispatcher } = await import('../src/services/ingress/ingressEventDispatcher.js');
const { buildApp } = await import('../src/app.js');

test.after(() => { rawDb.close(); fs.rmSync(tempDirectory, { recursive: true, force: true }); });

const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('front.yard.person','Front Yard Person') RETURNING id").get() as { id: number };
const bindingId = Number(rawDb.prepare("INSERT INTO consumer_bindings (semantic_condition_id,consumer_type,binding_json) VALUES (?,'virtual_security_panel','{\"panelKey\":\"default\",\"zoneNumber\":4}')").run(condition.id).lastInsertRowid);
const logger = { child: () => logger, info: () => undefined, warn: () => undefined, error: () => undefined } as never;
let retainedState: 'active' | 'inactive' = 'inactive';
const consumer = async (action: { desiredState: 'active' | 'inactive'; bindingId: number; semanticCondition: { id: number; semanticKey: string }; binding: { panelKey: 'default'; zoneNumber: number }; traceId: string; routeId?: number; lifecycleIntent: 'trigger' | 'restore'; sourceEvent: { source: string; eventType: string | null; eventClass: string } }) => {
  const changed = retainedState !== action.desiredState;
  retainedState = action.desiredState;
  return {
    accepted: true, changed, delivered: changed, retained: true,
    reason: changed ? 'state_changed_and_sent' : 'state_unchanged',
    consumerType: 'virtual_security_panel' as const, bindingId: action.bindingId,
    semanticConditionId: action.semanticCondition.id, semanticKey: action.semanticCondition.semanticKey,
    desiredState: action.desiredState, mappedConsumerState: action.desiredState === 'active' ? 'Violated' as const : 'Normal' as const,
    panelKey: action.binding.panelKey, zoneNumber: action.binding.zoneNumber, traceId: action.traceId,
    routeId: action.routeId, lifecycleIntent: action.lifecycleIntent, source: action.sourceEvent.source,
    eventType: action.sourceEvent.eventType, eventClass: action.sourceEvent.eventClass
  };
};

function protectEvent(traceId: string, restore = false) {
  return {
    source: 'protect_api' as const, ingressType: 'api' as const, timestamp: '2026-08-06T00:00:00Z', eventId: traceId,
    eventType: 'smartDetectZone', eventClass: 'zone' as const, cameraId: 'camera-1', objectTypes: ['person'],
    userId: null, userName: null, doorId: null, doorName: null, credentialProvider: null, result: null,
    raw: restore ? { item: { end: 1 } } : { item: {} }, diagnosticsOnly: false,
    resolvedSource: { sourceType: 'protect_source', sourceId: 1 }, lifecycle: restore ? 'update' : 'add'
  };
}

async function executeProtect(traceId: string, restore = false) {
  const planner = registerExecutionPlannerSubscriber({
    logger, timerService: { } as never, executors: [],
    semanticConditionHandler: (input) => executeSemanticConditionRoute({ ...input, consumer: consumer as never })
  });
  const gate = registerLifecycleExecutionGate({ logger, next: planner });
  await gate({
    event: protectEvent(traceId, restore), evaluatedRouteCount: 1, matchedRouteCount: 1,
    matches: [{ routeId: 41, bindingStatus: 'resolved', enabled: true, isExecutable: true, targetType: 'semantic_condition', targetId: condition.id }],
    nonMatchSummary: { missing_resolved_source: 0, source_mismatch: 0, event_class_mismatch: 0, upstream_event_type_mismatch: 0, object_type_mismatch: 0 }
  });
}

function records(traceId: string) {
  return rawDb.prepare('SELECT * FROM execution_diagnostics WHERE trace_id = ? ORDER BY sequence, id').all(traceId) as Array<Record<string, unknown>>;
}

test('Protect trigger and restore persist shared semantic, binding, and aggregate diagnostics with trace continuity', async () => {
  await executeProtect('protect-active');
  const active = records('protect-active');
  assert.deepEqual(active.map((row) => row.diagnostic_type), ['semantic_action', 'consumer_binding', 'semantic_aggregate']);
  assert.equal(active.every((row) => row.trace_id === 'protect-active'), true);
  assert.equal(active[0].requested_state, 'active');
  assert.equal(active[0].lifecycle_intent, 'trigger');
  assert.equal(active[0].route_id, 41);
  assert.equal(active[1].consumer_binding_id, bindingId);
  assert.deepEqual(JSON.parse(active[1].destination_summary_json as string), { panelKey: 'default', zoneNumber: 4, mappedState: 'Violated' });
  assert.equal(active[1].reason, 'state_changed_and_sent');

  await executeProtect('protect-inactive', true);
  const inactive = records('protect-inactive');
  assert.equal(inactive[0].requested_state, 'inactive');
  assert.equal(inactive[0].lifecycle_intent, 'restore');
  assert.deepEqual(JSON.parse(inactive[1].destination_summary_json as string), { panelKey: 'default', zoneNumber: 4, mappedState: 'Normal' });
  assert.equal(inactive[1].reason, 'state_changed_and_sent');

  await executeProtect('protect-repeat-inactive', true);
  assert.equal(records('protect-repeat-inactive')[1].reason, 'state_unchanged');
});

test('Semantic Webhook active and inactive use the same downstream diagnostic shape', async () => {
  const dispatcher = new IngressEventDispatcher();
  registerSemanticActionPlannerSubscriber({
    dispatcher, logger,
    semanticConditionHandler: (input) => executeSemanticConditionRoute({ ...input, consumer: consumer as never })
  });
  for (const requestedState of ['active', 'inactive'] as const) {
    const traceId = `semantic-${requestedState}`;
    await dispatcher.publish({
      source: 'semantic_webhook', ingressType: 'webhook', timestamp: '2026-08-06T00:00:00Z', eventId: traceId,
      eventType: `semantic.${requestedState}`, eventClass: 'semantic_state', cameraId: null, objectTypes: [],
      userId: null, userName: null, doorId: null, doorName: null, credentialProvider: null, result: null,
      raw: {}, diagnosticsOnly: false, precision: {
        semanticWebhookId: 8, webhookKey: 'front-yard', semanticConditionId: condition.id,
        requestedState, lifecycleIntent: requestedState === 'active' ? 'trigger' : 'restore', sharedSecretValidated: true
      }
    });
    const rows = records(traceId);
    assert.deepEqual(rows.map((row) => row.diagnostic_type), ['semantic_action', 'consumer_binding', 'semantic_aggregate']);
    assert.equal(rows.every((row) => row.trace_id === traceId && row.source === 'semantic_webhook'), true);
    assert.equal(rows[0].semantic_webhook_id, 8);
    assert.equal(rows[0].webhook_key, 'front-yard');
  }
});

test('binding failures remain ordered and visible without hiding later results', async () => {
  const secondBindingId = Number(rawDb.prepare("INSERT INTO consumer_bindings (semantic_condition_id,consumer_type,binding_json) VALUES (?,'virtual_security_panel','{\"panelKey\":\"default\",\"zoneNumber\":5}')").run(condition.id).lastInsertRowid);
  await executeSemanticConditionRoute({
    routeId: 42, semanticConditionId: condition.id, event: protectEvent('protect-partial'),
    lifecycleIntent: 'trigger', desiredState: 'active', logger,
    consumer: (async (action: { bindingId: number }) => {
      if (action.bindingId === bindingId) throw new Error('planned failure');
      return {
        accepted: true, changed: true, delivered: true, retained: true, reason: 'state_changed_and_sent',
        consumerType: 'virtual_security_panel', bindingId: action.bindingId, semanticConditionId: condition.id,
        semanticKey: 'front.yard.person', desiredState: 'active', mappedConsumerState: 'Violated',
        panelKey: 'default', zoneNumber: 5, traceId: 'protect-partial', routeId: 42,
        lifecycleIntent: 'trigger', source: 'protect_api', eventType: 'smartDetectZone', eventClass: 'zone'
      };
    }) as never
  });
  const bindingRecords = records('protect-partial').filter((row) => row.diagnostic_type === 'consumer_binding');
  assert.deepEqual(bindingRecords.map((row) => row.consumer_binding_id), [bindingId, secondBindingId]);
  assert.deepEqual(bindingRecords.map((row) => row.reason), ['consumer_failed', 'state_changed_and_sent']);
  assert.equal(records('protect-partial').at(-1)?.reason, 'consumer_bindings_partially_completed');
});

test('trace-filterable diagnostics API exposes structured context without secret material', async () => {
  const app = buildApp();
  const response = await app.inject({ method: 'GET', url: '/api/execution-diagnostics?traceId=protect-active' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().map((row: { diagnosticType: string }) => row.diagnosticType), ['semantic_action', 'consumer_binding', 'semantic_aggregate']);
  assert.deepEqual(response.json()[1].destinationSummary, { panelKey: 'default', zoneNumber: 4, mappedState: 'Violated' });
  assert.doesNotMatch(response.body, /sharedSecret|encryptedSecret|authentication/i);
  await app.close();
});

test('disabled condition records rejection without consumer binding execution', async () => {
  rawDb.prepare('UPDATE semantic_conditions SET enabled = 0 WHERE id = ?').run(condition.id);
  await executeProtect('protect-disabled');
  const disabled = records('protect-disabled');
  assert.deepEqual(disabled.map((row) => row.diagnostic_type), ['semantic_action']);
  assert.equal(disabled[0].reason, 'semantic_condition_disabled');
  rawDb.prepare('UPDATE semantic_conditions SET enabled = 1 WHERE id = ?').run(condition.id);
});
