import {
  NormalizedEventClass,
  NormalizedIngressEvent,
  ProtectSourceResolutionContext
} from '../ingress/normalizedEvent.js';

export interface ProtectApiEventEnvelope {
  type?: unknown;
  item?: {
    device?: unknown;
    type?: unknown;
    smartDetectTypes?: unknown;
    start?: unknown;
    end?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface NormalizedProtectApiEvent extends Omit<NormalizedIngressEvent<ProtectApiEventEnvelope>, 'resolvedSource' | 'lifecycle' | 'precision'> {
  source: 'protect_api';
  ingressType: 'api';
  cameraId: string | null;
  eventType: string | null;
  eventClass: NormalizedEventClass;
  objectTypes: string[];
  raw: ProtectApiEventEnvelope;
  diagnosticsOnly: true;
}

export interface ResolvedNormalizedProtectApiEvent extends NormalizedProtectApiEvent {
  resolvedSource: ProtectSourceResolutionContext | null;
  lifecycle: string;
}

function mapEventClass(eventType: string | null): NormalizedEventClass {
  switch (eventType) {
    case 'smartDetectZone':
      return 'zone';
    case 'smartDetectLine':
      return 'line';
    case 'motion':
      return 'motion';
    case 'smartAudioDetect':
      return 'audio';
    default:
      return 'unknown';
  }
}

function toObjectTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function toTimestamp(start: unknown): string {
  if (typeof start === 'number' && Number.isFinite(start)) {
    return new Date(start).toISOString();
  }

  return new Date().toISOString();
}

export function normalizeProtectApiEvent(raw: ProtectApiEventEnvelope): NormalizedProtectApiEvent {
  const item = raw.item;
  const cameraId = typeof item?.device === 'string' && item.device.trim() ? item.device : null;
  const eventType = typeof item?.type === 'string' && item.type.trim() ? item.type : null;

  return {
    source: 'protect_api',
    ingressType: 'api',
    eventId: null,
    cameraId,
    eventType,
    eventClass: mapEventClass(eventType),
    objectTypes: toObjectTypes(item?.smartDetectTypes),
    userId: null,
    userName: null,
    doorId: null,
    doorName: null,
    credentialProvider: null,
    result: null,
    timestamp: toTimestamp(item?.start),
    raw,
    diagnosticsOnly: true
  };
}
