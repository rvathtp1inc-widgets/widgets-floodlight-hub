import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import Fastify from 'fastify';

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'semantic-auto-restore-'));
const dbPath = path.join(tempDirectory, 'test.db');
const sqlite = new Database(dbPath);
for (const migration of fs.readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) sqlite.exec(fs.readFileSync(path.join('drizzle', migration), 'utf8'));
sqlite.close();
process.env.DB_PATH = dbPath;
process.env.ACCESS_ENABLED = 'false';
process.env.FLOODLIGHT_HUB_CONFIG_PATH = path.join(tempDirectory, 'not-provisioned.json');

const { rawDb } = await import('../src/db/client.js');
const { encryptString } = await import('../src/lib/secrets.js');
const { handleSemanticWebhook } = await import('../src/services/webhooks/semanticWebhookService.js');
const { handleSemanticWebhookTimerExpiry } = await import('../src/services/webhooks/semanticWebhookAutoRestoreService.js');
const { SemanticWebhookTimerManager } = await import('../src/services/webhooks/semanticWebhookTimerManager.js');
const { IngressEventDispatcher } = await import('../src/services/ingress/ingressEventDispatcher.js');
const { registerSemanticActionPlannerSubscriber } = await import('../src/services/execution/executionPlannerSubscriber.js');
const { executeSemanticConditionRoute } = await import('../src/services/execution/semanticConditionExecutionService.js');
const { semanticWebhookRoutes } = await import('../src/routes/semanticWebhooks.js');

const logger = { child: () => logger, info: () => undefined, warn: () => undefined, error: () => undefined } as never;
const condition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('auto.vehicle','Auto Vehicle') RETURNING id").get() as { id: number };
rawDb.prepare("INSERT INTO consumer_bindings (semantic_condition_id,consumer_type,binding_json) VALUES (?,'virtual_security_panel','{\"panelKey\":\"default\",\"zoneNumber\":14}')").run(condition.id);
const insertWebhook = rawDb.prepare(`INSERT INTO semantic_condition_webhooks
  (semantic_condition_id,display_name,webhook_key,encrypted_shared_secret,restore_mode,auto_restore_seconds,enabled)
  VALUES (?, ?, ?, ?, ?, ?, ?)`);
const explicitId = Number(insertWebhook.run(condition.id, 'Explicit', 'explicit-auto-test', encryptString('correct'), 'explicit_inactive', null, 1).lastInsertRowid);
const autoCondition = rawDb.prepare("INSERT INTO semantic_conditions (semantic_key,label) VALUES ('auto.person','Auto Person') RETURNING id").get() as { id: number };
rawDb.prepare("INSERT INTO consumer_bindings (semantic_condition_id,consumer_type,binding_json) VALUES (?,'virtual_security_panel','{\"panelKey\":\"default\",\"zoneNumber\":15}')").run(autoCondition.id);
const autoId = Number(insertWebhook.run(autoCondition.id, 'Auto', 'auto-timeout-test', encryptString('correct'), 'auto_timeout', 30, 1).lastInsertRowid);

test.after(() => { rawDb.close(); fs.rmSync(tempDirectory, { recursive: true, force: true }); });

function acceptedDispatcher(onPublish?: () => void) {
  const dispatcher = new IngressEventDispatcher();
  dispatcher.subscribe(() => {
    onPublish?.();
    return { kind: 'semantic_action_planner_result', semanticConditionId: autoCondition.id, lifecycleIntent: 'trigger', desiredState: 'active', execution: {
      accepted: true, changed: false, delivered: false, retained: true, reason: 'consumer_bindings_completed', results: [{ reason: 'state_unchanged' }]
    } };
  });
  return dispatcher;
}

function webhookInput(webhookKey: string, requestedState: 'active' | 'inactive', dispatcher: InstanceType<typeof IngressEventDispatcher>, timerManager: InstanceType<typeof SemanticWebhookTimerManager>, secret = 'correct') {
  return { webhookKey, requestedState, method: 'POST', headers: { 'x-widgets-secret': secret }, logger, ingressEventDispatcher: dispatcher, timerManager };
}

test('runtime timer manager resets full duration, cancels, and does not persist or restore timers', async () => {
  let expirations = 0;
  let nextHandle = 0;
  const callbacks = new Map<number, () => void>();
  const clock = {
    setTimeout(callback: () => void) { nextHandle += 1; callbacks.set(nextHandle, callback); return nextHandle as unknown as ReturnType<typeof setTimeout>; },
    clearTimeout(handle: ReturnType<typeof setTimeout>) { callbacks.delete(handle as unknown as number); }
  };
  const manager = new SemanticWebhookTimerManager(async () => { expirations += 1; }, clock as never);
  manager.scheduleOrReset(10, 40);
  const firstCallback = callbacks.get(1)!;
  manager.scheduleOrReset(10, 40);
  firstCallback();
  assert.equal(expirations, 0);
  callbacks.get(2)!();
  await Promise.resolve();
  assert.equal(expirations, 1);
  manager.scheduleOrReset(11, 1);
  manager.cancel(11);
  assert.equal(manager.has(11), false);
  const restarted = new SemanticWebhookTimerManager(async () => undefined);
  assert.equal(restarted.has(10), false);
  assert.equal(rawDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%timer%'").all().length, 1);
  manager.stopAll();
});

test('webhook Active/Inactive owns timer activity only after authentication and shared-path acceptance', async () => {
  const manager = new SemanticWebhookTimerManager(async () => undefined);
  const dispatcher = acceptedDispatcher();
  assert.equal((await handleSemanticWebhook(webhookInput('explicit-auto-test', 'active', dispatcher, manager))).body.accepted, true);
  assert.equal(manager.has(explicitId), false);

  assert.equal((await handleSemanticWebhook(webhookInput('auto-timeout-test', 'active', dispatcher, manager))).body.accepted, true);
  assert.equal(manager.has(autoId), true);
  manager.scheduleOrReset(autoId, 30);
  await handleSemanticWebhook(webhookInput('auto-timeout-test', 'active', dispatcher, manager, 'wrong'));
  assert.equal(manager.has(autoId), true);
  rawDb.prepare('UPDATE semantic_condition_webhooks SET enabled = 0 WHERE id = ?').run(autoId);
  await handleSemanticWebhook(webhookInput('auto-timeout-test', 'active', dispatcher, manager));
  assert.equal(manager.has(autoId), true);
  rawDb.prepare('UPDATE semantic_condition_webhooks SET enabled = 1 WHERE id = ?').run(autoId);

  let timerPresentDuringInactivePublish = true;
  const inactiveDispatcher = acceptedDispatcher(() => { timerPresentDuringInactivePublish = manager.has(autoId); });
  await handleSemanticWebhook(webhookInput('auto-timeout-test', 'inactive', inactiveDispatcher, manager));
  assert.equal(timerPresentDuringInactivePublish, false);
  assert.equal(manager.has(autoId), false);

  const failedDispatcher = new IngressEventDispatcher();
  await handleSemanticWebhook(webhookInput('auto-timeout-test', 'active', failedDispatcher, manager));
  assert.equal(manager.has(autoId), false);
  manager.stopAll();
});

test('management disable, mode change, and delete cancel runtime timers', async () => {
  const manager = new SemanticWebhookTimerManager(async () => undefined);
  const app = Fastify({ logger: false });
  await semanticWebhookRoutes(app, manager);
  manager.scheduleOrReset(autoId, 30);
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${autoId}`, payload: { enabled: false } })).statusCode, 200);
  assert.equal(manager.has(autoId), false);
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${autoId}`, payload: { enabled: true } });
  manager.scheduleOrReset(autoId, 30);
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${autoId}`, payload: { restoreMode: 'explicit_inactive', autoRestoreSeconds: null } });
  assert.equal(manager.has(autoId), false);
  await app.inject({ method: 'PATCH', url: `/api/semantic-webhooks/${autoId}`, payload: { restoreMode: 'auto_timeout', autoRestoreSeconds: 30 } });
  manager.scheduleOrReset(autoId, 30);
  await app.inject({ method: 'DELETE', url: `/api/semantic-webhooks/${autoId}` });
  assert.equal(manager.has(autoId), false);
  await app.close();
});

test('timer expiry revalidates and submits inactive through shared execution with timeout diagnostics', async () => {
  const replacementId = Number(insertWebhook.run(autoCondition.id, 'Auto Replacement', 'auto-timeout-replacement', encryptString('correct'), 'auto_timeout', 30, 1).lastInsertRowid);
  const dispatcher = new IngressEventDispatcher();
  registerSemanticActionPlannerSubscriber({
    dispatcher, logger,
    semanticConditionHandler: (input) => executeSemanticConditionRoute({ ...input, consumer: (async (action) => ({
      accepted: true, changed: true, delivered: true, retained: true, reason: 'state_changed_and_sent',
      consumerType: 'virtual_security_panel', bindingId: action.bindingId,
      semanticConditionId: action.semanticCondition.id, semanticKey: action.semanticCondition.semanticKey,
      desiredState: action.desiredState, mappedConsumerState: 'Normal', panelKey: action.binding.panelKey,
      zoneNumber: action.binding.zoneNumber, traceId: action.traceId, routeId: action.routeId,
      lifecycleIntent: action.lifecycleIntent, source: action.sourceEvent.source,
      eventType: action.sourceEvent.eventType, eventClass: action.sourceEvent.eventClass
    })) as never })
  });
  const result = await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: dispatcher });
  assert.equal(result.accepted, true);
  const rows = rawDb.prepare('SELECT * FROM execution_diagnostics WHERE trace_id = ? ORDER BY sequence').all(result.traceId) as Array<Record<string, unknown>>;
  assert.deepEqual(rows.map((row) => row.diagnostic_type), ['semantic_action', 'consumer_binding', 'semantic_aggregate']);
  assert.equal(rows.every((row) => row.ingress_type === 'timer' && row.state_origin === 'auto_timeout' && row.timer_expired === 1 && row.auto_restore_seconds === 30), true);
  assert.equal(rows.every((row) => row.requested_state === 'inactive' && row.lifecycle_intent === 'restore'), true);
  assert.doesNotMatch(JSON.stringify(rows), /correct|shared_secret|encrypted_secret/i);

  let publications = 0;
  const rejectingDispatcher = new IngressEventDispatcher();
  rejectingDispatcher.subscribe(() => { publications += 1; });
  rawDb.prepare('UPDATE semantic_condition_webhooks SET enabled = 0 WHERE id = ?').run(replacementId);
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'webhook_disabled');
  rawDb.prepare("UPDATE semantic_condition_webhooks SET enabled = 1, restore_mode = 'explicit_inactive' WHERE id = ?").run(replacementId);
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'auto_restore_configuration_invalid');
  rawDb.prepare("UPDATE semantic_condition_webhooks SET restore_mode = 'auto_timeout', auto_restore_seconds = 30 WHERE id = ?").run(replacementId);
  rawDb.prepare('UPDATE semantic_conditions SET enabled = 0 WHERE id = ?').run(autoCondition.id);
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'semantic_condition_disabled');
  rawDb.prepare('UPDATE semantic_conditions SET enabled = 1 WHERE id = ?').run(autoCondition.id);
  rawDb.prepare('UPDATE semantic_condition_webhooks SET auto_restore_seconds = 0 WHERE id = ?').run(replacementId);
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'auto_restore_configuration_invalid');
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: 999_999, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'webhook_not_found');
  rawDb.prepare('UPDATE semantic_condition_webhooks SET auto_restore_seconds = 30 WHERE id = ?').run(replacementId);
  rawDb.pragma('foreign_keys = OFF');
  rawDb.prepare('DELETE FROM semantic_conditions WHERE id = ?').run(autoCondition.id);
  rawDb.pragma('foreign_keys = ON');
  assert.equal((await handleSemanticWebhookTimerExpiry({ semanticWebhookId: replacementId, logger, ingressEventDispatcher: rejectingDispatcher })).reason, 'semantic_condition_not_found');
  assert.equal(publications, 0);
});
