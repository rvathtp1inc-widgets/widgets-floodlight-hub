import {
  NormalizedEventClass,
  NormalizedIngressEvent,
  ProtectSourceResolutionContext,
  WebhookTargetHintType
} from '../ingress/normalizedEvent.js';

type JsonObject = Record<string, unknown>;

export interface NormalizedWebhookEvent extends NormalizedIngressEvent<unknown> {
  source: 'protect_webhook';
  ingressType: 'webhook';
  precision: {
    webhookKey: string;
    targetHintType?: WebhookTargetHintType;
    targetHintId?: number;
    sharedSecretValidated: boolean;
  };
}

export interface WebhookEventNormalizationInput {
  webhookKey: string;
  payload?: unknown;
  receivedAt?: string;
  targetHintType: WebhookTargetHintType | null;
  targetHintId: number | null;
  sharedSecretValidated: boolean;
  resolvedSource: ProtectSourceResolutionContext | null;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getPathValue(source: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function readString(source: unknown, paths: string[]): string | null {
  if (!isPlainObject(source)) {
    return null;
  }

  for (const path of paths) {
    const value = getPathValue(source, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readStringArray(source: unknown, paths: string[]): string[] {
  if (!isPlainObject(source)) {
    return [];
  }

  for (const path of paths) {
    const value = getPathValue(source, path);
    if (!Array.isArray(value)) {
      continue;
    }

    const deduped = new Set<string>();
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        deduped.add(item.trim());
      }
    }

    return [...deduped];
  }

  return [];
}

function toIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp.toISOString();
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const timestamp = new Date(milliseconds);
    if (!Number.isNaN(timestamp.getTime())) {
      return timestamp.toISOString();
    }
  }

  return fallback;
}

function mapEventClass(eventType: string | null): NormalizedEventClass {
  const normalized = eventType?.trim().toLowerCase() ?? '';
  if (normalized === 'smartdetectzone' || normalized.includes('zone')) {
    return 'zone';
  }

  if (normalized === 'smartdetectline' || normalized.includes('line')) {
    return 'line';
  }

  if (normalized.includes('motion')) {
    return 'motion';
  }

  if (normalized.includes('audio')) {
    return 'audio';
  }

  return 'unknown';
}

function extractTimestamp(payload: unknown, fallback: string): string {
  if (!isPlainObject(payload)) {
    return fallback;
  }

  const candidates = [
    'timestamp',
    'eventTime',
    'event_time',
    'start',
    'event.start',
    'alarmTime',
    'alarm.time'
  ];

  for (const path of candidates) {
    const value = getPathValue(payload, path);
    const parsed = toIsoTimestamp(value, fallback);
    if (parsed !== fallback) {
      return parsed;
    }
  }

  return fallback;
}

function extractEventType(payload: unknown): string | null {
  const direct = readString(payload, [
    'eventType',
    'event_type',
    'type',
    'event.type',
    'alarmType',
    'alarm_type'
  ]);

  if (direct) {
    return direct;
  }

  return readString(payload, ['smartDetectType', 'smart_detect_type', 'objectType', 'object_type']);
}

function extractObjectTypes(payload: unknown): string[] {
  const list = readStringArray(payload, [
    'smartDetectTypes',
    'smart_detect_types',
    'objectTypes',
    'object_types',
    'event.smartDetectTypes'
  ]);

  if (list.length > 0) {
    return list;
  }

  const single = readString(payload, ['smartDetectType', 'smart_detect_type', 'objectType', 'object_type']);
  return single ? [single] : [];
}

export function extractWebhookCameraId(payload: unknown): string | null {
  return readString(payload, [
    'cameraId',
    'camera_id',
    'device',
    'deviceId',
    'camera.id',
    'camera',
    'item.device',
    'event.cameraId',
    'event.camera_id',
    'alarm.cameraId',
    'alarm.camera_id'
  ]);
}

export function normalizeWebhookEvent(input: WebhookEventNormalizationInput): NormalizedWebhookEvent {
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const cameraId = extractWebhookCameraId(input.payload);
  const eventType = extractEventType(input.payload);

  return {
    source: 'protect_webhook',
    ingressType: 'webhook',
    timestamp: extractTimestamp(input.payload, receivedAt),
    cameraId,
    eventType,
    eventClass: mapEventClass(eventType),
    objectTypes: extractObjectTypes(input.payload),
    raw: input.payload ?? null,
    diagnosticsOnly: true,
    resolvedSource: input.resolvedSource,
    precision: {
      webhookKey: input.webhookKey,
      targetHintType: input.targetHintType ?? undefined,
      targetHintId: input.targetHintId ?? undefined,
      sharedSecretValidated: input.sharedSecretValidated
    }
  };
}
