export type NormalizedEventSource = 'protect_api' | 'protect_webhook';
export type NormalizedEventIngressType = 'api' | 'webhook';
export type NormalizedEventClass = 'zone' | 'line' | 'motion' | 'audio' | 'unknown';
export type WebhookTargetHintType = 'floodlight' | 'group';

export interface ProtectSourceResolutionContext {
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
  [key: string]: unknown;
}

export interface NormalizedIngressEvent<TRaw = unknown> {
  source: NormalizedEventSource;
  ingressType: NormalizedEventIngressType;
  timestamp: string;
  cameraId: string | null;
  eventType: string | null;
  eventClass: NormalizedEventClass;
  objectTypes: string[];
  raw: TRaw;
  diagnosticsOnly: true;
  resolvedSource?: ProtectSourceResolutionContext | null;
  lifecycle?: string;
  precision?: NormalizedEventPrecision;
}
