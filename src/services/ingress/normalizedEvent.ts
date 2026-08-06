export type NormalizedEventSource = 'protect_api' | 'protect_webhook' | 'access' | 'semantic_webhook';
export type NormalizedEventIngressType = 'api' | 'webhook' | 'poll' | 'timer';
export type NormalizedEventClass = 'zone' | 'line' | 'motion' | 'audio' | 'access_control' | 'semantic_state' | 'unknown';
export type WebhookTargetHintType = 'floodlight' | 'group';

export interface SourceResolutionContext {
  sourceType: string;
  sourceId: number;
}

export interface ProtectSourceResolutionContext extends SourceResolutionContext {
  sourceType: 'protect_source';
  sourceId: number;
  protectCameraId: string;
  name: string;
  modelKey: string;
  state: string;
  lastSeenAt: string;
  lastEventSeenAt: string | null;
}

export interface NormalizedEventPrecision {
  webhookKey?: string;
  targetHintType?: WebhookTargetHintType;
  targetHintId?: number;
  sharedSecretValidated?: boolean;
  semanticWebhookId?: number;
  semanticConditionId?: number;
  semanticConditionLabel?: string;
  requestedState?: 'active' | 'inactive';
  lifecycleIntent?: 'trigger' | 'restore';
  stateOrigin?: 'explicit_active' | 'explicit_inactive' | 'auto_timeout';
  timerExpired?: boolean;
  autoRestoreSeconds?: number;
  [key: string]: unknown;
}

export interface NormalizedIngressEvent<TRaw = unknown> {
  source: NormalizedEventSource;
  ingressType: NormalizedEventIngressType;
  timestamp: string;
  eventId: string | null;
  eventType: string | null;
  eventClass: NormalizedEventClass;
  cameraId: string | null;
  objectTypes: string[];
  userId: string | null;
  userName: string | null;
  doorId: string | null;
  doorName: string | null;
  credentialProvider: string | null;
  result: string | null;
  raw: TRaw;
  diagnosticsOnly: boolean;
  resolvedSource?: SourceResolutionContext | ProtectSourceResolutionContext | null;
  lifecycle?: string;
  precision?: NormalizedEventPrecision;
}
