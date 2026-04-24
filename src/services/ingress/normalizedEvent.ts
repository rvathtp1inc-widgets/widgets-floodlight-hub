export type NormalizedEventSource = 'protect_api' | 'protect_webhook' | 'access';
export type NormalizedEventIngressType = 'api' | 'webhook' | 'poll';
export type NormalizedEventClass = 'zone' | 'line' | 'motion' | 'audio' | 'access_control' | 'unknown';
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
  diagnosticsOnly: true;
  resolvedSource?: SourceResolutionContext | ProtectSourceResolutionContext | null;
  lifecycle?: string;
  precision?: NormalizedEventPrecision;
}
