import { asc, count, eq, inArray } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { DateTime } from 'luxon';
import { ProtectApiConfig } from '../../config.js';
import { db } from '../../db/client.js';
import { protectSources } from '../../db/schema.js';
import { ProtectSourceResolutionContext } from '../ingress/normalizedEvent.js';
import { loadPersistedProtectApiConfig } from './protectApiSettings.js';

const PROTECT_CAMERAS_PATH = '/proxy/protect/integration/v1/cameras';

interface ProtectSourceSyncResult {
  inserted: number;
  updated: number;
  skipped: number;
  totalKnownSources: number;
}

interface ProtectCameraRecord {
  protectCameraId: string;
  name: string;
  modelKey: string;
  state: string;
  supportsSmartDetect: boolean;
  supportedObjectTypesJson: string;
  enabledObjectTypesJson: string;
  lastSeenAt: string;
  updatedAt: string;
  rawJson: string | null;
}

type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function buildProtectUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return text ? { raw: text } : {};
  }

  return response.json();
}

function describeErrorBody(body: unknown): string {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const message = (body as { error?: unknown; message?: unknown }).error ?? (body as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body;
  }

  return JSON.stringify(body);
}

function getPathValue(source: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      deduped.add(item.trim());
    }
  }

  return [...deduped];
}

function readCandidateStringArray(source: JsonObject, paths: string[]): string[] {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (Array.isArray(value)) {
      return toStringArray(value);
    }
  }

  return [];
}

function readString(source: JsonObject, path: string): string | null {
  const value = getPathValue(source, path);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeDeviceIdentifier(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isCandidateDeviceIdentifierKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('mac')
    || normalized.includes('address')
    || normalized.includes('device')
    || normalized.includes('serial');
}

function rawJsonContainsDeviceIdentifier(value: unknown, normalizedIdentifier: string): boolean {
  if (typeof value === 'string') {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => rawJsonContainsDeviceIdentifier(item, normalizedIdentifier));
  }

  if (!isPlainObject(value)) {
    return false;
  }

  for (const [key, child] of Object.entries(value)) {
    if (isCandidateDeviceIdentifierKey(key)) {
      if (typeof child === 'string' && normalizeDeviceIdentifier(child) === normalizedIdentifier) {
        return true;
      }

      if (Array.isArray(child) && child.some((item) => typeof item === 'string' && normalizeDeviceIdentifier(item) === normalizedIdentifier)) {
        return true;
      }
    }

    if (rawJsonContainsDeviceIdentifier(child, normalizedIdentifier)) {
      return true;
    }
  }

  return false;
}

function hasTruthyValue(source: JsonObject, path: string): boolean {
  const value = getPathValue(source, path);
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    return ['true', '1', 'enabled', 'supported'].includes(value.trim().toLowerCase());
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return isPlainObject(value);
}

function mapSupportsSmartDetect(camera: JsonObject, supportedTypes: string[], enabledTypes: string[]): boolean {
  if (supportedTypes.length > 0 || enabledTypes.length > 0) {
    return true;
  }

  return [
    'featureFlags.hasSmartDetect',
    'featureFlags.smartDetect',
    'featureFlags.smartDetectTypes',
    'capabilities.hasSmartDetect',
    'capabilities.smartDetect',
    'capabilities.smartDetectTypes',
    'smartDetectSettings',
    'smartDetectSettings.enabled',
    'isSmartDetectEnabled'
  ].some((path) => hasTruthyValue(camera, path));
}

function mapCameraRecord(camera: unknown, observedAt: string): ProtectCameraRecord | null {
  if (!isPlainObject(camera)) {
    return null;
  }

  const protectCameraId = readString(camera, 'id');
  const name = readString(camera, 'name');
  const modelKey = readString(camera, 'modelKey');
  const state = readString(camera, 'state');

  if (!protectCameraId || !name || !modelKey || !state) {
    return null;
  }

  const supportedObjectTypes = readCandidateStringArray(camera, [
    'capabilities.smartDetect.supportedObjectTypes',
    'capabilities.smartDetect.supportedTypes',
    'capabilities.smartDetect.objectTypes',
    'capabilities.smartDetectTypes',
    'featureFlags.smartDetectObjectTypes',
    'featureFlags.smartDetectTypes',
    'smartDetectSettings.supportedObjectTypes',
    'smartDetectSettings.supportedTypes',
    'supportedSmartDetectTypes',
    'smartDetectTypes'
  ]);

  const enabledObjectTypes = readCandidateStringArray(camera, [
    'smartDetectSettings.objectTypes',
    'smartDetectSettings.enabledObjectTypes',
    'smartDetectSettings.objectTypesEnabled',
    'recordingSettings.smartDetectTypes',
    'enabledSmartDetectTypes',
    'smartDetectTypes'
  ]);

  return {
    protectCameraId,
    name,
    modelKey,
    state,
    supportsSmartDetect: mapSupportsSmartDetect(camera, supportedObjectTypes, enabledObjectTypes),
    supportedObjectTypesJson: JSON.stringify(supportedObjectTypes),
    enabledObjectTypesJson: JSON.stringify(enabledObjectTypes),
    lastSeenAt: observedAt,
    updatedAt: observedAt,
    rawJson: JSON.stringify(camera)
  };
}

function extractCameraArray(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (isPlainObject(body)) {
    const candidates = [body.cameras, body.data];
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }

  throw new Error('Protect cameras response was not an array.');
}

export class ProtectSourceSyncService {
  private readonly logger: FastifyBaseLogger;

  constructor(
    logger: FastifyBaseLogger,
    private readonly loadProtectApiConfig: () => Promise<ProtectApiConfig> = loadPersistedProtectApiConfig
  ) {
    this.logger = logger.child({ service: 'protectSourceSync' });
  }

  async listSources() {
    return db.select().from(protectSources).orderBy(asc(protectSources.name), asc(protectSources.id));
  }

  async resolveSourceByCameraId(cameraId: string): Promise<ProtectSourceResolutionContext | null> {
    const trimmedCameraId = cameraId.trim();
    if (!trimmedCameraId) {
      return null;
    }

    const row = await db
      .select({
        id: protectSources.id,
        protectCameraId: protectSources.protectCameraId,
        name: protectSources.name,
        modelKey: protectSources.modelKey,
        state: protectSources.state,
        lastSeenAt: protectSources.lastSeenAt,
        lastEventSeenAt: protectSources.lastEventSeenAt
      })
      .from(protectSources)
      .where(eq(protectSources.protectCameraId, trimmedCameraId))
      .limit(1);

    const source = row[0];
    if (!source) {
      return null;
    }

    return {
      sourceType: 'protect_source',
      sourceId: source.id,
      protectCameraId: source.protectCameraId,
      name: source.name,
      modelKey: source.modelKey,
      state: source.state,
      lastSeenAt: source.lastSeenAt,
      lastEventSeenAt: source.lastEventSeenAt
    };
  }

  async resolveSourceByDeviceIdentifier(deviceIdentifier: string): Promise<ProtectSourceResolutionContext | null> {
    const normalizedIdentifier = normalizeDeviceIdentifier(deviceIdentifier);
    if (!normalizedIdentifier) {
      return null;
    }

    const byCameraId = await this.resolveSourceByCameraId(deviceIdentifier);
    if (byCameraId) {
      return byCameraId;
    }

    const rows = await db
      .select({
        id: protectSources.id,
        protectCameraId: protectSources.protectCameraId,
        name: protectSources.name,
        modelKey: protectSources.modelKey,
        state: protectSources.state,
        lastSeenAt: protectSources.lastSeenAt,
        lastEventSeenAt: protectSources.lastEventSeenAt,
        rawJson: protectSources.rawJson
      })
      .from(protectSources);

    const matches = [];
    for (const row of rows) {
      if (!row.rawJson) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(row.rawJson) as unknown;
      } catch {
        continue;
      }

      if (rawJsonContainsDeviceIdentifier(parsed, normalizedIdentifier)) {
        matches.push(row);
      }
    }

    if (matches.length !== 1) {
      if (matches.length > 1) {
        this.logger.warn(
          {
            deviceIdentifier,
            normalizedIdentifier,
            matchedSourceIds: matches.map((row) => row.id)
          },
          'Protect webhook device identifier matched multiple raw protect sources; source left unresolved.'
        );
      }

      return null;
    }

    const source = matches[0];
    return {
      sourceType: 'protect_source',
      sourceId: source.id,
      protectCameraId: source.protectCameraId,
      name: source.name,
      modelKey: source.modelKey,
      state: source.state,
      lastSeenAt: source.lastSeenAt,
      lastEventSeenAt: source.lastEventSeenAt
    };
  }

  async markSourceEventSeen(sourceId: number, seenAt: string): Promise<void> {
    await db
      .update(protectSources)
      .set({
        lastEventSeenAt: seenAt
      })
      .where(eq(protectSources.id, sourceId));
  }

  async syncSources(): Promise<ProtectSourceSyncResult> {
    const protectApiConfig = await this.loadProtectApiConfig();

    if (!protectApiConfig.enabled) {
      throw new Error('Protect API sync is disabled.');
    }

    if (!protectApiConfig.baseUrl) {
      throw new Error('Protect API base URL is not configured.');
    }

    if (!protectApiConfig.apiKey) {
      throw new Error('Protect API key is not configured.');
    }

    const response = await fetch(buildProtectUrl(protectApiConfig.baseUrl, PROTECT_CAMERAS_PATH), {
      method: 'GET',
      headers: {
        'X-API-KEY': protectApiConfig.apiKey,
        accept: 'application/json'
      }
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new Error(`Protect camera sync failed with HTTP ${response.status}: ${describeErrorBody(body)}`);
    }

    const cameras = extractCameraArray(body);
    const observedAt = DateTime.utc().toISO()!;
    const mappedRecords = cameras
      .map((camera) => mapCameraRecord(camera, observedAt))
      .filter((camera): camera is ProtectCameraRecord => camera !== null);

    const cameraIds = mappedRecords.map((camera) => camera.protectCameraId);
    const existingRows = cameraIds.length > 0
      ? await db
        .select({
          id: protectSources.id,
          protectCameraId: protectSources.protectCameraId,
          lastEventSeenAt: protectSources.lastEventSeenAt
        })
        .from(protectSources)
        .where(inArray(protectSources.protectCameraId, cameraIds))
      : [];

    const existingByCameraId = new Map(existingRows.map((row) => [row.protectCameraId, row]));

    let inserted = 0;
    let updated = 0;

    for (const record of mappedRecords) {
      const existing = existingByCameraId.get(record.protectCameraId);
      if (existing) {
        await db
          .update(protectSources)
          .set({
            name: record.name,
            modelKey: record.modelKey,
            state: record.state,
            supportsSmartDetect: record.supportsSmartDetect,
            supportedObjectTypesJson: record.supportedObjectTypesJson,
            enabledObjectTypesJson: record.enabledObjectTypesJson,
            lastSeenAt: record.lastSeenAt,
            updatedAt: record.updatedAt,
            rawJson: record.rawJson
          })
          .where(eq(protectSources.id, existing.id));
        updated += 1;
        continue;
      }

      await db.insert(protectSources).values(record);
      inserted += 1;
    }

    const totals = await db.select({ total: count() }).from(protectSources);
    const totalKnownSources = totals[0]?.total ?? 0;
    const skipped = cameras.length - mappedRecords.length;

    this.logger.info(
      {
        inserted,
        updated,
        skipped,
        totalKnownSources
      },
      'Protect source sync completed.'
    );

    return {
      inserted,
      updated,
      skipped,
      totalKnownSources
    };
  }
}
