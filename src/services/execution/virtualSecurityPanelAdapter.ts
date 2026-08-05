import { VirtualSecurityPanelConsumer } from '../virtualSecurityPanel/types.js';
import { ConsumerAction } from './virtualSecurityPanelDiagnosticsConsumer.js';

export interface PlatformConsumerResult {
  accepted: boolean;
  changed: boolean;
  delivered: boolean;
  retained: boolean;
  reason: string;
  consumerType: 'virtual_security_panel';
  bindingId: number;
  semanticConditionId: number;
  semanticKey: string;
  desiredState: 'active' | 'inactive';
  mappedConsumerState: 'Normal' | 'Violated';
  panelKey: string;
  zoneNumber: number;
  traceId: string;
  routeId: number;
  lifecycleIntent: 'trigger' | 'restore';
  source: string;
  eventType: string | null;
  eventClass: string;
}

function invalidResult(action: ConsumerAction, reason: 'invalid_binding' | 'invalid_state'): PlatformConsumerResult {
  return {
    accepted: false, changed: false, delivered: false, retained: false, reason,
    consumerType: 'virtual_security_panel', bindingId: action.bindingId,
    semanticConditionId: action.semanticCondition.id, semanticKey: action.semanticCondition.semanticKey,
    desiredState: action.desiredState, mappedConsumerState: action.desiredState === 'active' ? 'Violated' : 'Normal',
    panelKey: action.binding.panelKey, zoneNumber: action.binding.zoneNumber, traceId: action.traceId,
    routeId: action.routeId, lifecycleIntent: action.lifecycleIntent, source: action.sourceEvent.source,
    eventType: action.sourceEvent.eventType, eventClass: action.sourceEvent.eventClass
  };
}

export function createVirtualSecurityPanelAdapter(consumer: VirtualSecurityPanelConsumer) {
  return async function virtualSecurityPanelAdapter(action: ConsumerAction): Promise<PlatformConsumerResult> {
    if (action.consumerType !== 'virtual_security_panel' || action.binding.panelKey !== 'default' ||
      !Number.isInteger(action.binding.zoneNumber) || action.binding.zoneNumber < 1 || action.binding.zoneNumber > 208) {
      return invalidResult(action, 'invalid_binding');
    }
    if (action.desiredState !== 'active' && action.desiredState !== 'inactive') {
      return invalidResult(action, 'invalid_state');
    }
    const mappedConsumerState = action.desiredState === 'active' ? 'Violated' : 'Normal';
    const result = await consumer.setDesiredState({
      consumerBinding: { zoneNumber: action.binding.zoneNumber },
      desiredState: mappedConsumerState,
      executionContext: {
        executionId: action.traceId,
        routeId: action.routeId,
        sourceEventId: action.sourceEvent.eventId ?? undefined,
        bindingId: action.bindingId,
        semanticConditionId: action.semanticCondition.id,
        semanticKey: action.semanticCondition.semanticKey,
        semanticLabel: action.semanticCondition.label,
        lifecycleIntent: action.lifecycleIntent,
        sourceEvent: action.sourceEvent
      }
    });
    return {
      ...result,
      consumerType: 'virtual_security_panel', bindingId: action.bindingId,
      semanticConditionId: action.semanticCondition.id, semanticKey: action.semanticCondition.semanticKey,
      desiredState: action.desiredState, mappedConsumerState, panelKey: action.binding.panelKey,
      zoneNumber: action.binding.zoneNumber, traceId: action.traceId, routeId: action.routeId,
      lifecycleIntent: action.lifecycleIntent, source: action.sourceEvent.source,
      eventType: action.sourceEvent.eventType, eventClass: action.sourceEvent.eventClass
    };
  };
}

export type VirtualSecurityPanelAdapter = ReturnType<typeof createVirtualSecurityPanelAdapter>;

export function virtualSecurityPanelUnavailableResult(action: ConsumerAction): PlatformConsumerResult {
  return {
    ...invalidResult(action, 'invalid_binding'),
    reason: 'consumer_unavailable'
  };
}
