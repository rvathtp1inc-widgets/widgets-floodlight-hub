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

export type DiagnosticsConsumer = (action: ConsumerAction, logger: FastifyBaseLogger) => Promise<DiagnosticsConsumerResult>;

export async function executeSemanticConditionRoute(input: {
  routeId: number;
  semanticConditionId: number;
  event: NormalizedIngressEvent;
  lifecycleIntent: 'trigger' | 'restore';
  desiredState: 'active' | 'inactive';
  logger: FastifyBaseLogger;
  consumer?: DiagnosticsConsumer;
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
  const results: Array<DiagnosticsConsumerResult | { accepted: false; delivered: false; reason: 'consumer_failed'; bindingId: number }> = [];
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
      results.push(await (input.consumer ?? virtualSecurityPanelDiagnosticsConsumer)(action, input.logger));
    } catch (error) {
      input.logger.error({ routeId: input.routeId, bindingId: row.id, err: error }, 'Diagnostics consumer binding attempt failed; continuing without retry.');
      results.push({ accepted: false, delivered: false, reason: 'consumer_failed', bindingId: row.id });
    }
  }
  return { accepted: true, delivered: false, reason: 'diagnostics_bindings_planned', results };
}
