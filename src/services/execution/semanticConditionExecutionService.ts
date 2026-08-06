import { asc, and, eq } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client.js';
import { consumerBindings, semanticConditions } from '../../db/schema.js';
import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';
import {
  ConsumerAction,
  DiagnosticsConsumerResult,
  virtualSecurityPanelDiagnosticsConsumer
} from './virtualSecurityPanelDiagnosticsConsumer.js';
import { PlatformConsumerResult } from './virtualSecurityPanelAdapter.js';
import { insertExecutionDiagnosticWithRetention } from '../diagnostics/logRetentionService.js';

export type PlatformConsumer = (
  action: ConsumerAction,
  logger: FastifyBaseLogger
) => Promise<DiagnosticsConsumerResult | PlatformConsumerResult>;

export async function executeSemanticConditionRoute(input: {
  routeId?: number;
  semanticConditionId: number;
  event: NormalizedIngressEvent;
  lifecycleIntent: 'trigger' | 'restore';
  desiredState: 'active' | 'inactive';
  logger: FastifyBaseLogger;
  consumer?: PlatformConsumer;
}) {
  const traceId = input.event.eventId ?? (input.routeId !== undefined
    ? `route-${input.routeId}-${input.event.timestamp}`
    : `${input.event.source}-${input.semanticConditionId}-${input.event.timestamp}`);
  const diagnosticBase = {
    traceId,
    ingressType: input.event.ingressType,
    source: input.event.source,
    sourceEventType: input.event.eventType,
    sourceEventClass: input.event.eventClass,
    routeId: input.routeId ?? null,
    semanticWebhookId: typeof input.event.precision?.semanticWebhookId === 'number' ? input.event.precision.semanticWebhookId : null,
    webhookKey: typeof input.event.precision?.webhookKey === 'string' ? input.event.precision.webhookKey : null,
    semanticConditionId: input.semanticConditionId,
    requestedState: input.desiredState,
    lifecycleIntent: input.lifecycleIntent,
    stateOrigin: typeof input.event.precision?.stateOrigin === 'string' ? input.event.precision.stateOrigin : null,
    timerExpired: typeof input.event.precision?.timerExpired === 'boolean' ? input.event.precision.timerExpired : null,
    autoRestoreSeconds: typeof input.event.precision?.autoRestoreSeconds === 'number' ? input.event.precision.autoRestoreSeconds : null
  };
  const rejectAction = async (reason: string, condition?: typeof semanticConditions.$inferSelect) => {
    await insertExecutionDiagnosticWithRetention({
      ...diagnosticBase,
      diagnosticType: 'semantic_action', sequence: 0,
      semanticConditionKey: condition?.semanticKey ?? null,
      semanticConditionLabel: condition?.label ?? null,
      accepted: false, changed: false, delivered: false, retained: false, reason,
      bindingCount: 0, successfulBindingCount: 0, failedBindingCount: 0
    });
    return { accepted: false, delivered: false, reason, results: [] };
  };
  const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, input.semanticConditionId) });
  if (!condition) return rejectAction('semantic_condition_missing');
  if (!condition.enabled) return rejectAction('semantic_condition_disabled', condition);
  if (condition.restorePolicy !== 'source_lifecycle') return rejectAction('unsupported_restore_policy', condition);
  const bindings = await db.select().from(consumerBindings)
    .where(and(eq(consumerBindings.semanticConditionId, condition.id), eq(consumerBindings.enabled, true)))
    .orderBy(asc(consumerBindings.id));
  await insertExecutionDiagnosticWithRetention({
    ...diagnosticBase,
    diagnosticType: 'semantic_action', sequence: 0,
    semanticConditionKey: condition.semanticKey, semanticConditionLabel: condition.label,
    accepted: true, changed: false, delivered: false, retained: false,
    reason: 'semantic_condition_action_accepted', bindingCount: bindings.length,
    successfulBindingCount: 0, failedBindingCount: 0
  });
  if (bindings.length === 0) {
    await insertExecutionDiagnosticWithRetention({
      ...diagnosticBase,
      diagnosticType: 'semantic_aggregate', sequence: 1,
      semanticConditionKey: condition.semanticKey, semanticConditionLabel: condition.label,
      accepted: true, changed: false, delivered: false, retained: false,
      reason: 'no_enabled_consumer_bindings', bindingCount: 0,
      successfulBindingCount: 0, failedBindingCount: 0
    });
    return { accepted: true, delivered: false, reason: 'no_enabled_consumer_bindings', results: [] };
  }
  const desiredState = input.desiredState;
  const results: Array<DiagnosticsConsumerResult | PlatformConsumerResult | { accepted: false; delivered: false; reason: 'consumer_failed'; bindingId: number }> = [];
  for (const row of bindings) {
    try {
      const binding = JSON.parse(row.bindingJson) as { panelKey: 'default'; zoneNumber: number };
      const action: ConsumerAction = {
        traceId,
        routeId: input.routeId,
        bindingId: row.id,
        consumerType: 'virtual_security_panel',
        semanticCondition: { id: condition.id, semanticKey: condition.semanticKey, label: condition.label },
        binding,
        desiredState,
        lifecycleIntent: input.lifecycleIntent,
        sourceEvent: {
          source: input.event.source,
          ingressType: input.event.ingressType,
          eventId: input.event.eventId,
          eventType: input.event.eventType,
          eventClass: input.event.eventClass,
          timestamp: input.event.timestamp
        }
      };
      const result = await (input.consumer ?? virtualSecurityPanelDiagnosticsConsumer)(action, input.logger);
      results.push(result);
      await insertExecutionDiagnosticWithRetention({
        ...diagnosticBase,
        diagnosticType: 'consumer_binding', sequence: results.length,
        semanticConditionKey: condition.semanticKey, semanticConditionLabel: condition.label,
        consumerBindingId: row.id, consumerType: action.consumerType,
        destinationSummaryJson: JSON.stringify({
          panelKey: action.binding.panelKey,
          zoneNumber: action.binding.zoneNumber,
          mappedState: 'mappedConsumerState' in result ? result.mappedConsumerState : desiredState === 'active' ? 'Violated' : 'Normal'
        }),
        accepted: result.accepted,
        changed: 'changed' in result ? result.changed : null,
        delivered: result.delivered,
        retained: 'retained' in result ? result.retained : null,
        reason: result.reason
      });
      input.logger.info({
        traceId: action.traceId, routeId: input.routeId, semanticConditionId: condition.id,
        semanticKey: condition.semanticKey, bindingId: row.id, consumerType: action.consumerType,
        desiredState: action.desiredState, lifecycleIntent: action.lifecycleIntent,
        panelKey: action.binding.panelKey, zoneNumber: action.binding.zoneNumber,
        accepted: result.accepted, delivered: result.delivered, reason: result.reason,
        changed: 'changed' in result ? result.changed : undefined,
        retained: 'retained' in result ? result.retained : undefined,
        mappedConsumerState: 'mappedConsumerState' in result ? result.mappedConsumerState : undefined,
        source: action.sourceEvent.source, eventType: action.sourceEvent.eventType,
        eventClass: action.sourceEvent.eventClass
      }, 'Consumer action completed with recorded delivery outcome.');
    } catch (error) {
      input.logger.error({ routeId: input.routeId, bindingId: row.id, err: error }, 'Consumer binding attempt failed; continuing without retry.');
      results.push({ accepted: false, delivered: false, reason: 'consumer_failed', bindingId: row.id });
      await insertExecutionDiagnosticWithRetention({
        ...diagnosticBase,
        diagnosticType: 'consumer_binding', sequence: results.length,
        semanticConditionKey: condition.semanticKey, semanticConditionLabel: condition.label,
        consumerBindingId: row.id, consumerType: row.consumerType,
        destinationSummaryJson: JSON.stringify({
          ...(JSON.parse(row.bindingJson) as Record<string, unknown>),
          mappedState: desiredState === 'active' ? 'Violated' : 'Normal'
        }),
        accepted: false, changed: false, delivered: false, retained: false,
        reason: 'consumer_failed'
      });
    }
  }
  const acceptedCount = results.filter((result) => result.accepted).length;
  const accepted = acceptedCount > 0;
  const changed = results.some((result) => 'changed' in result && result.changed === true);
  const delivered = results.some((result) => result.delivered);
  const retained = results.some((result) => result.accepted && 'retained' in result && result.retained === true);
  const allUnavailable = results.every((result) => result.reason === 'consumer_unavailable');
  const reason = allUnavailable
    ? 'consumer_unavailable'
    : acceptedCount === results.length
    ? 'consumer_bindings_completed'
    : accepted
      ? 'consumer_bindings_partially_completed'
      : 'consumer_bindings_failed';
  await insertExecutionDiagnosticWithRetention({
    ...diagnosticBase,
    diagnosticType: 'semantic_aggregate', sequence: results.length + 1,
    semanticConditionKey: condition.semanticKey, semanticConditionLabel: condition.label,
    accepted, changed, delivered, retained, reason,
    bindingCount: results.length, successfulBindingCount: acceptedCount,
    failedBindingCount: results.length - acceptedCount
  });
  return { accepted, changed, delivered, retained, reason, results };
}
