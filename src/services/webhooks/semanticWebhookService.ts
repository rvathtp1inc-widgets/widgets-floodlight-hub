import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client.js';
import { semanticConditions, semanticConditionWebhooks } from '../../db/schema.js';
import { insertEventLogWithRetention } from '../diagnostics/logRetentionService.js';
import { submitSemanticState } from '../execution/semanticStateSubmissionService.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';
import { authenticateWebhookSecret } from './webhookService.js';
import { SemanticWebhookTimerManager } from './semanticWebhookTimerManager.js';

export async function handleSemanticWebhook(input: {
  webhookKey: string;
  requestedState: 'active' | 'inactive';
  method: string;
  remoteIp?: string;
  headers: Record<string, unknown>;
  logger: FastifyBaseLogger;
  ingressEventDispatcher: IngressEventDispatcher;
  timerManager: SemanticWebhookTimerManager;
}) {
  const receivedAt = new Date().toISOString();
  const traceId = crypto.randomUUID();
  const webhook = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.webhookKey, input.webhookKey) });
  if (!webhook) {
    await insertEventLogWithRetention({
      webhookKey: input.webhookKey, targetType: 'semantic_condition', targetId: null,
      httpMethod: input.method, remoteIp: input.remoteIp, headerSummary: null, payloadRaw: null,
      authResult: 'not_evaluated', decision: 'rejected', decisionReason: 'webhook_not_found'
    });
    input.logger.warn({ traceId, webhookKey: input.webhookKey, requestedState: input.requestedState, accepted: false, reason: 'webhook_not_found' }, 'Semantic webhook rejected.');
    return { status: 404, body: { accepted: false, reason: 'webhook_not_found', traceId } };
  }

  const authentication = await authenticateWebhookSecret({ headers: input.headers, encryptedSecret: webhook.encryptedSharedSecret, requireConfiguredSecret: true });
  const reject = async (status: number, reason: string, conditionLabel?: string) => {
    await insertEventLogWithRetention({
      webhookKey: webhook.webhookKey, targetType: 'semantic_condition', targetId: webhook.semanticConditionId,
      httpMethod: input.method, remoteIp: input.remoteIp,
      headerSummary: JSON.stringify({ [authentication.headerName.toLowerCase()]: authentication.provided ? 'present' : 'missing' }),
      payloadRaw: null, authResult: authentication.valid ? 'valid' : 'invalid', decision: 'rejected', decisionReason: reason
    });
    input.logger.warn({
      traceId, webhookKey: webhook.webhookKey, semanticWebhookId: webhook.id,
      semanticConditionId: webhook.semanticConditionId, semanticConditionLabel: conditionLabel,
      requestedState: input.requestedState, lifecycleIntent: input.requestedState === 'active' ? 'trigger' : 'restore',
      authenticationResult: authentication.valid ? 'valid' : 'invalid', accepted: false, reason
    }, 'Semantic webhook rejected.');
    return { status, body: { accepted: false, reason, traceId } };
  };
  if (!authentication.valid) return reject(401, 'invalid_secret');
  if (!webhook.enabled) return reject(403, 'webhook_disabled');
  const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, webhook.semanticConditionId) });
  if (!condition) return reject(404, 'semantic_condition_not_found');
  if (!condition.enabled) return reject(403, 'semantic_condition_disabled', condition.label);
  if (webhook.restoreMode === 'auto_timeout' && (!Number.isInteger(webhook.autoRestoreSeconds) || webhook.autoRestoreSeconds === null || webhook.autoRestoreSeconds < 1 || webhook.autoRestoreSeconds > 86_400)) {
    return reject(409, 'auto_restore_configuration_invalid', condition.label);
  }

  if (input.requestedState === 'inactive') input.timerManager.cancel(webhook.id);
  const lifecycleIntent = input.requestedState === 'active' ? 'trigger' : 'restore';
  const stateOrigin = input.requestedState === 'active' ? 'explicit_active' : 'explicit_inactive';
  const submission = await submitSemanticState({
    traceId, timestamp: receivedAt, webhookKey: webhook.webhookKey, semanticWebhookId: webhook.id,
    semanticConditionId: condition.id, semanticConditionLabel: condition.label,
    desiredState: input.requestedState, lifecycleIntent,
    sourceContext: { ingressType: 'webhook', stateOrigin, timerExpired: false },
    logger: input.logger, ingressEventDispatcher: input.ingressEventDispatcher
  });
  const execution = submission.execution;
  const accepted = execution?.accepted === true;
  const reason = execution?.reason ?? 'execution_planner_unavailable';
  if (accepted && input.requestedState === 'active' && webhook.restoreMode === 'auto_timeout') {
    input.timerManager.scheduleOrReset(webhook.id, webhook.autoRestoreSeconds as number);
  }
  await insertEventLogWithRetention({
    webhookKey: webhook.webhookKey, targetType: 'semantic_condition', targetId: condition.id,
    httpMethod: input.method, remoteIp: input.remoteIp,
    headerSummary: JSON.stringify({
      [authentication.headerName.toLowerCase()]: 'present', traceId, stateOrigin,
      timerExpired: false, timerScheduled: accepted && input.requestedState === 'active' && webhook.restoreMode === 'auto_timeout'
    }), payloadRaw: null,
    authResult: 'valid', decision: accepted ? 'accepted' : 'rejected', decisionReason: reason
  });
  return {
    status: accepted ? 200 : 409,
    body: {
      accepted, reason, traceId, webhookKey: webhook.webhookKey, semanticWebhookId: webhook.id,
      semanticConditionId: condition.id, semanticConditionLabel: condition.label,
      requestedState: input.requestedState, lifecycleIntent, stateOrigin, timerExpired: false,
      changed: execution && 'changed' in execution ? execution.changed : false,
      delivered: execution?.delivered ?? false,
      retained: execution && 'retained' in execution ? execution.retained : false,
      results: execution?.results ?? []
    }
  };
}
