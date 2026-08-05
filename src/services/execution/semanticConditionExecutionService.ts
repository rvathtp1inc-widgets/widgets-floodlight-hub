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

export type PlatformConsumer = (
  action: ConsumerAction,
  logger: FastifyBaseLogger
) => Promise<DiagnosticsConsumerResult | PlatformConsumerResult>;

export async function executeSemanticConditionRoute(input: {
  routeId: number;
  semanticConditionId: number;
  event: NormalizedIngressEvent;
  lifecycleIntent: 'trigger' | 'restore';
  desiredState: 'active' | 'inactive';
  logger: FastifyBaseLogger;
  consumer?: PlatformConsumer;
}) {
  const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, input.semanticConditionId) });
  if (!condition) return { accepted: false, delivered: false, reason: 'semantic_condition_missing', results: [] };
  if (!condition.enabled) return { accepted: false, delivered: false, reason: 'semantic_condition_disabled', results: [] };
  if (condition.restorePolicy !== 'source_lifecycle') return { accepted: false, delivered: false, reason: 'unsupported_restore_policy', results: [] };
  const bindings = await db.select().from(consumerBindings)
    .where(and(eq(consumerBindings.semanticConditionId, condition.id), eq(consumerBindings.enabled, true)))
    .orderBy(asc(consumerBindings.id));
  if (bindings.length === 0) return { accepted: true, delivered: false, reason: 'no_enabled_consumer_bindings', results: [] };
  const desiredState = input.desiredState;
  const results: Array<DiagnosticsConsumerResult | PlatformConsumerResult | { accepted: false; delivered: false; reason: 'consumer_failed'; bindingId: number }> = [];
  for (const row of bindings) {
    try {
      const binding = JSON.parse(row.bindingJson) as { panelKey: 'default'; zoneNumber: number };
      const action: ConsumerAction = {
        traceId: input.event.eventId ?? `route-${input.routeId}-${input.event.timestamp}`,
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
  return { accepted, changed, delivered, retained, reason, results };
}
