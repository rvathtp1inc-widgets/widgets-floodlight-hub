export const MIN_VIRTUAL_SECURITY_ZONE = 1;
export const MAX_VIRTUAL_SECURITY_ZONE = 208;

export type VirtualSecurityDesiredState = 'Normal' | 'Violated';
export type VirtualSecurityDeliveryStatus = 'never_sent' | 'sent' | 'pending_reconnect' | 'send_failed';
export type VirtualSecurityPanelLifecycle =
  | 'stopped'
  | 'starting'
  | 'listening'
  | 'connected'
  | 'stopping'
  | 'faulted';

export interface VirtualSecurityConsumerBinding { zoneNumber: number; }

export interface SetVirtualSecurityStateRequest {
  consumerBinding: VirtualSecurityConsumerBinding;
  desiredState: VirtualSecurityDesiredState;
  executionContext?: {
    executionId?: string;
    routeId?: number;
    sourceEventId?: string;
    bindingId?: number;
    semanticConditionId?: number;
    semanticKey?: string;
    semanticLabel?: string;
    lifecycleIntent?: 'trigger' | 'restore';
    sourceEvent?: {
      source: string;
      ingressType: string;
      eventId: string | null;
      eventType: string | null;
      eventClass: string;
      timestamp: string;
    };
  };
}

export interface SetVirtualSecurityStateResult {
  accepted: boolean;
  changed: boolean;
  delivered: boolean;
  retained: boolean;
  reason:
    | 'state_changed_and_sent'
    | 'state_changed_retained_disconnected'
    | 'state_unchanged'
    | 'invalid_binding'
    | 'invalid_state'
    | 'transport_send_failed';
  zoneNumber?: number;
  desiredState?: VirtualSecurityDesiredState;
}

export interface RetainedVirtualSecurityZoneState {
  zoneNumber: number;
  currentState: VirtualSecurityDesiredState;
  lastChangedAt: string;
  lastDeliveryAt?: string;
  deliveryStatus: VirtualSecurityDeliveryStatus;
}

export interface VirtualSecurityPanelStatus {
  lifecycle: VirtualSecurityPanelLifecycle;
  connected: boolean;
  listeningAddress?: string;
  retainedStates: RetainedVirtualSecurityZoneState[];
}

export interface VirtualSecurityPanelConsumer {
  start(): Promise<void>;
  stop(): Promise<void>;
  setDesiredState(request: SetVirtualSecurityStateRequest): Promise<SetVirtualSecurityStateResult>;
  getStatus(): VirtualSecurityPanelStatus;
}

export interface VirtualSecurityPanelLogger {
  debug(fields: Record<string, unknown>, message?: string): void;
  info(fields: Record<string, unknown>, message?: string): void;
  warn(fields: Record<string, unknown>, message?: string): void;
  error(fields: Record<string, unknown>, message?: string): void;
}
