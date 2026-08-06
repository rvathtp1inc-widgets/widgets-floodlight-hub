import { FastifyBaseLogger } from 'fastify';

export type PlatformDesiredState = 'active' | 'inactive';
export interface ConsumerAction {
  traceId: string;
  routeId?: number;
  bindingId: number;
  consumerType: 'virtual_security_panel';
  semanticCondition: { id: number; semanticKey: string; label: string };
  binding: { panelKey: 'default'; zoneNumber: number };
  desiredState: PlatformDesiredState;
  lifecycleIntent: 'trigger' | 'restore';
  sourceEvent: { source: string; ingressType: string; eventId: string | null; eventType: string | null; eventClass: string; timestamp: string };
}

export interface DiagnosticsConsumerResult {
  accepted: true;
  delivered: false;
  reason: 'diagnostics_stub_planned_not_delivered';
  consumerType: 'virtual_security_panel';
  bindingId: number;
  semanticConditionId: number;
  semanticKey: string;
  desiredState: PlatformDesiredState;
  mappedConsumerState: 'Normal' | 'Violated';
  panelKey: 'default';
  zoneNumber: number;
  traceId: string;
}

export async function virtualSecurityPanelDiagnosticsConsumer(
  action: ConsumerAction,
  logger: FastifyBaseLogger
): Promise<DiagnosticsConsumerResult> {
  const result: DiagnosticsConsumerResult = {
    accepted: true,
    delivered: false,
    reason: 'diagnostics_stub_planned_not_delivered',
    consumerType: 'virtual_security_panel',
    bindingId: action.bindingId,
    semanticConditionId: action.semanticCondition.id,
    semanticKey: action.semanticCondition.semanticKey,
    desiredState: action.desiredState,
    mappedConsumerState: action.desiredState === 'active' ? 'Violated' : 'Normal',
    panelKey: action.binding.panelKey,
    zoneNumber: action.binding.zoneNumber,
    traceId: action.traceId
  };
  logger.info({
    traceId: action.traceId,
    routeId: action.routeId,
    semanticConditionId: action.semanticCondition.id,
    semanticKey: action.semanticCondition.semanticKey,
    bindingId: action.bindingId,
    consumerType: action.consumerType,
    desiredState: action.desiredState,
    lifecycleIntent: action.lifecycleIntent,
    panelKey: action.binding.panelKey,
    zoneNumber: action.binding.zoneNumber,
    accepted: result.accepted,
    delivered: result.delivered,
    reason: result.reason,
    source: action.sourceEvent.source,
    eventType: action.sourceEvent.eventType,
    eventClass: action.sourceEvent.eventClass
  }, 'Consumer action planned; diagnostics stub accepted it; no transport delivery occurred.');
  return result;
}
