import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client.js';
import { semanticConditions, semanticConditionWebhooks } from '../../db/schema.js';
import { insertEventLogWithRetention } from '../diagnostics/logRetentionService.js';
import { submitSemanticState } from '../execution/semanticStateSubmissionService.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';

function validSeconds(value: number | null): value is number {
  return Number.isInteger(value) && value !== null && value >= 1 && value <= 86_400;
}

export async function handleSemanticWebhookTimerExpiry(input: {
  semanticWebhookId: number;
  logger: FastifyBaseLogger;
  ingressEventDispatcher: IngressEventDispatcher;
}) {
  const traceId = crypto.randomUUID();
  const webhook = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.id, input.semanticWebhookId) });
  const reject = async (reason: string, webhookKey = `semantic-webhook:${input.semanticWebhookId}`, conditionId: number | null = null) => {
    await insertEventLogWithRetention({
      webhookKey, targetType: 'semantic_condition', targetId: conditionId, httpMethod: 'TIMER',
      headerSummary: JSON.stringify({ semanticWebhookId: input.semanticWebhookId, timerExpired: true }),
      payloadRaw: null, authResult: 'not_applicable', decision: 'rejected', decisionReason: reason
    });
    input.logger.warn({ traceId, semanticWebhookId: input.semanticWebhookId, timerExpired: true, stateOrigin: 'auto_timeout', accepted: false, reason }, 'Semantic webhook auto-restore timer rejected.');
    return { accepted: false, reason, traceId };
  };
  if (!webhook) return reject('webhook_not_found');
  if (!webhook.enabled) return reject('webhook_disabled', webhook.webhookKey, webhook.semanticConditionId);
  if (webhook.restoreMode !== 'auto_timeout' || !validSeconds(webhook.autoRestoreSeconds)) {
    return reject('auto_restore_configuration_invalid', webhook.webhookKey, webhook.semanticConditionId);
  }
  const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, webhook.semanticConditionId) });
  if (!condition) return reject('semantic_condition_not_found', webhook.webhookKey, webhook.semanticConditionId);
  if (!condition.enabled) return reject('semantic_condition_disabled', webhook.webhookKey, condition.id);
  const submission = await submitSemanticState({
    traceId, timestamp: new Date().toISOString(), semanticWebhookId: webhook.id,
    webhookKey: webhook.webhookKey, semanticConditionId: condition.id,
    semanticConditionLabel: condition.label, desiredState: 'inactive', lifecycleIntent: 'restore',
    sourceContext: {
      ingressType: 'timer', stateOrigin: 'auto_timeout', timerExpired: true,
      autoRestoreSeconds: webhook.autoRestoreSeconds
    },
    logger: input.logger, ingressEventDispatcher: input.ingressEventDispatcher
  });
  const execution = submission.execution;
  const accepted = execution?.accepted === true;
  const reason = execution?.reason ?? 'execution_planner_unavailable';
  await insertEventLogWithRetention({
    webhookKey: webhook.webhookKey, targetType: 'semantic_condition', targetId: condition.id,
    httpMethod: 'TIMER', headerSummary: JSON.stringify({
      traceId, semanticWebhookId: webhook.id, timerExpired: true,
      stateOrigin: 'auto_timeout', autoRestoreSeconds: webhook.autoRestoreSeconds
    }), payloadRaw: null, authResult: 'not_applicable',
    decision: accepted ? 'accepted' : 'rejected', decisionReason: reason
  });
  return { accepted, reason, traceId, execution };
}
