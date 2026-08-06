import { FastifyBaseLogger } from 'fastify';
import { SemanticActionPlannerResult } from './executionPlannerSubscriber.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';
import { normalizeSemanticWebhookEvent } from '../webhooks/normalizeSemanticWebhookEvent.js';

export async function submitSemanticState(input: {
  traceId: string;
  timestamp: string;
  semanticWebhookId: number;
  webhookKey: string;
  semanticConditionId: number;
  semanticConditionLabel: string;
  desiredState: 'active' | 'inactive';
  lifecycleIntent: 'trigger' | 'restore';
  sourceContext: {
    ingressType: 'webhook' | 'timer';
    stateOrigin: 'explicit_active' | 'explicit_inactive' | 'auto_timeout';
    timerExpired: boolean;
    autoRestoreSeconds?: number;
  };
  logger: FastifyBaseLogger;
  ingressEventDispatcher: IngressEventDispatcher;
}) {
  const normalizedEvent = normalizeSemanticWebhookEvent({
    traceId: input.traceId,
    receivedAt: input.timestamp,
    webhookKey: input.webhookKey,
    semanticWebhookId: input.semanticWebhookId,
    semanticConditionId: input.semanticConditionId,
    semanticConditionLabel: input.semanticConditionLabel,
    requestedState: input.desiredState,
    ingressType: input.sourceContext.ingressType,
    stateOrigin: input.sourceContext.stateOrigin,
    timerExpired: input.sourceContext.timerExpired,
    autoRestoreSeconds: input.sourceContext.autoRestoreSeconds
  });
  input.logger.info({
    traceId: input.traceId,
    webhookKey: input.webhookKey,
    semanticWebhookId: input.semanticWebhookId,
    semanticConditionId: input.semanticConditionId,
    semanticConditionLabel: input.semanticConditionLabel,
    requestedState: input.desiredState,
    lifecycleIntent: input.lifecycleIntent,
    stateOrigin: input.sourceContext.stateOrigin,
    timerExpired: input.sourceContext.timerExpired,
    normalizedEvent
  }, 'Semantic state normalized for ingress dispatcher publication.');
  const publicationResults = await input.ingressEventDispatcher.publish(normalizedEvent);
  const plannerResult = publicationResults.find((value): value is SemanticActionPlannerResult =>
    !!value && typeof value === 'object' && (value as { kind?: string }).kind === 'semantic_action_planner_result'
  );
  return { normalizedEvent, execution: plannerResult?.execution };
}
