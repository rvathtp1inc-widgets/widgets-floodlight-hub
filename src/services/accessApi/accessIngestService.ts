import crypto from 'node:crypto';
import { asc, count, eq, inArray } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { AccessConfig } from '../../config.js';
import { db, rawDb } from '../../db/client.js';
import { accessDoors, accessIngestState, accessUsers } from '../../db/schema.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';
import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';

const ACCESS_USERS_PATH = '/api/v1/developer/users';
const ACCESS_DOORS_PATH = '/api/v1/developer/doors';
const ACCESS_SYSTEM_LOGS_PATH = '/api/v1/developer/system/logs';
const ACCESS_LOG_TOPIC = 'door_openings';

type JsonObject = Record<string, unknown>;

type AccessUserUpsertRecord = {
  id: string;
  name: string | null;
  rawJson: string;
  lastSeenAt: string;
};

type AccessDoorUpsertRecord = {
  id: string;
  name: string | null;
  fullName: string | null;
  rawJson: string;
  lastSeenAt: string;
};

type AccessEventIdKind = 'stable' | 'fingerprint';

type AccessLogRecord = {
  raw: unknown;
  timestamp: string;
  eventId: string;
  eventIdKind: AccessEventIdKind;
  stableEventId: string | null;
  userId: string | null;
  userName: string | null;
  doorId: string | null;
  doorName: string | null;
  doorTargetFound: boolean;
  credentialProvider: string | null;
  result: string | null;
  eventType: string | null;
  receivedAt: string;
  processingLatencyMs: number;
  normalizedEvent: NormalizedIngressEvent<unknown>;
};

type AccessCursorState = {
  lastTimestamp: string | null;
  lastEventId: string | null;
  updatedAt: string;
};

export interface AccessInventorySyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  totalKnown: number;
}

export interface AccessPollResult {
  fetched: number;
  processed: number;
  skipped: number;
  skippedDuplicates: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  latencyMsMin: number;
  latencyMsMax: number;
  latencyMsAvg: number;
  latencySampleCount: number;
  inputOrderedAscending: boolean;
  inputOrderedDescending: boolean;
  uniqueTimestampCount: number;
  duplicateTimestampCount: number;
  stableEventIdsObserved: number;
  fingerprintEventIdsObserved: number;
  credentialProvidersObserved: string[];
  cursor: {
    lastTimestamp: string | null;
    lastEventId: string | null;
  };
}

export interface AccessPollStatus {
  enabled: boolean;
  configuredApiBaseUrl: string;
  pollIntervalMs: number;
  backgroundPollingConfigured: boolean;
  backgroundPollingRunning: boolean;
  pollInFlight: boolean;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastPollError: string | null;
  lastPollSummary: AccessPollResult | null;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getPathValue(source: unknown, path: string): unknown {
  if (!isPlainObject(source)) {
    return undefined;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isPlainObject(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function readString(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readArray(source: unknown, paths: string[]): unknown[] | null {
  for (const path of paths) {
    const value = getPathValue(source, path);
    if (Array.isArray(value)) {
      return value;
    }
  }

  return null;
}

function readObjectArray(source: unknown, paths: string[]): JsonObject[] {
  const values: JsonObject[] = [];

  for (const path of paths) {
    const value = getPathValue(source, path);
    if (Array.isArray(value)) {
      values.push(...value.filter((item): item is JsonObject => isPlainObject(item)));
      continue;
    }

    if (isPlainObject(value)) {
      values.push(value);
    }
  }

  return values;
}

function parseJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return response.text().then((text) => (text ? { raw: text } : {}));
  }

  return response.json();
}

function describeErrorBody(body: unknown): string {
  if (isPlainObject(body)) {
    const message = body.error ?? body.message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }

  if (typeof body === 'string' && body.trim()) {
    return body;
  }

  return JSON.stringify(body);
}

function buildAccessUrl(baseUrl: string, pathname: string): URL {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  url.search = '';
  url.hash = '';
  return url;
}

function buildAccessLogsUrl(baseUrl: string): URL {
  const url = buildAccessUrl(baseUrl, ACCESS_SYSTEM_LOGS_PATH);
  url.searchParams.set('page_size', '25');
  url.searchParams.set('page_num', '1');
  return url;
}

function buildAccessLogsRequestBody(): JsonObject {
  return { topic: ACCESS_LOG_TOPIC };
}

function extractRecordArray(body: unknown, candidatePaths: string[]): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }

  const arrayValue = readArray(body, candidatePaths);
  if (arrayValue) {
    return arrayValue;
  }

  throw new Error('Access API response did not contain a record array.');
}

function describeLogResponseShape(body: unknown, httpStatus: number): JsonObject {
  const data = getPathValue(body, 'data');

  return {
    httpStatus,
    accessResponseCode: readString(body, ['code']),
    topLevelKeys: isPlainObject(body) ? Object.keys(body).sort() : [],
    dataKeys: isPlainObject(data) ? Object.keys(data).sort() : [],
    dataHitsExists: getPathValue(body, 'data.hits') !== undefined,
    dataHitsIsArray: Array.isArray(getPathValue(body, 'data.hits'))
  };
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

function findDoorTarget(source: unknown): JsonObject | null {
  const candidates = readObjectArray(source, ['_source.target', '_source.targets', 'target', 'targets']);

  for (const candidate of candidates) {
    const targetType = readString(candidate, ['type', 'target_type']);
    if (targetType?.toLowerCase() === 'door') {
      return candidate;
    }
  }

  return null;
}

function buildFingerprint(input: {
  timestamp: string;
  userId: string | null;
  doorId: string | null;
  eventType: string | null;
  result: string | null;
  credentialProvider: string | null;
}): string {
  return crypto.createHash('sha256')
    .update([
      input.timestamp,
      input.userId ?? '',
      input.doorId ?? '',
      input.eventType ?? '',
      input.result ?? '',
      input.credentialProvider ?? ''
    ].join('|'))
    .digest('hex');
}

function mapUserRecord(user: unknown, observedAt: string): AccessUserUpsertRecord | null {
  const id = readString(user, ['id', 'user_id', 'user.id']);
  if (!id) {
    return null;
  }

  return {
    id,
    name: readString(user, ['name', 'display_name', 'full_name', 'user.name']),
    rawJson: JSON.stringify(user),
    lastSeenAt: observedAt
  };
}

function mapDoorRecord(door: unknown, observedAt: string): AccessDoorUpsertRecord | null {
  const id = readString(door, ['id', 'door_id', 'door.id']);
  if (!id) {
    return null;
  }

  const name = readString(door, ['name', 'display_name', 'door.name']);
  const fullName = readString(door, ['full_name', 'fullName', 'display_name', 'name', 'door.full_name']);

  return {
    id,
    name,
    fullName,
    rawJson: JSON.stringify(door),
    lastSeenAt: observedAt
  };
}

function normalizeAccessLogRecord(raw: unknown, receivedAt: string): AccessLogRecord {
  const nestedSource = getPathValue(raw, '_source');
  const source = isPlainObject(nestedSource) ? nestedSource : raw;
  const timestamp = toIsoTimestamp(
    getPathValue(raw, '@timestamp') ?? getPathValue(source, '@timestamp') ?? getPathValue(source, 'timestamp'),
    receivedAt
  );
  const userId = readString(source, ['actor.id', 'user.id']);
  const userName = readString(source, ['actor.display_name', 'actor.name', 'user.display_name', 'user.name']);
  const doorTarget = findDoorTarget(raw);
  const doorTargetFound = doorTarget !== null;
  const doorId = readString(doorTarget, ['id', 'target_id']) ?? readString(source, ['door.id', 'door_id']);
  const doorName = readString(doorTarget, ['display_name', 'name', 'full_name']) ?? readString(source, ['door.name', 'door.display_name']);
  const credentialProvider = readString(source, [
    'authentication.credential_provider',
    'authentication.credentialProvider',
    'credential_provider',
    'credentialProvider'
  ]);
  const eventType = readString(source, ['event.type', 'event_type', 'type']) ?? ACCESS_LOG_TOPIC;
  const result = readString(source, ['event.result', 'result']);
  const stableEventId = readString(raw, ['id', '_id', 'event_id', 'event.id'])
    ?? readString(source, ['event.id', 'id']);
  const eventId = stableEventId ?? buildFingerprint({
    timestamp,
    userId,
    doorId,
    eventType,
    result,
    credentialProvider
  });
  const eventIdKind: AccessEventIdKind = stableEventId ? 'stable' : 'fingerprint';
  const processingLatencyMs = Math.max(0, Date.now() - Date.parse(timestamp));

  const normalizedEvent: NormalizedIngressEvent<unknown> = {
    source: 'access',
    ingressType: 'poll',
    timestamp,
    eventId,
    eventType,
    eventClass: 'access_control',
    cameraId: null,
    objectTypes: [],
    userId,
    userName,
    doorId,
    doorName,
    credentialProvider,
    result,
    raw,
    diagnosticsOnly: true,
    precision: {
      pollTopic: ACCESS_LOG_TOPIC,
      eventIdKind,
      stableEventId,
      pollReceivedAt: receivedAt,
      processingLatencyMs,
      doorTargetFound
    }
  };

  return {
    raw,
    timestamp,
    eventId,
    eventIdKind,
    stableEventId,
    userId,
    userName,
    doorId,
    doorName,
    doorTargetFound,
    credentialProvider,
    result,
    eventType,
    receivedAt,
    processingLatencyMs,
    normalizedEvent
  };
}

export class AccessIngestService {
  private readonly logger: FastifyBaseLogger;
  private pollTimer: NodeJS.Timeout | null = null;
  private pollPromise: Promise<AccessPollResult> | null = null;
  private backgroundPollingRunning = false;
  private lastPollStartedAt: string | null = null;
  private lastPollCompletedAt: string | null = null;
  private lastPollError: string | null = null;
  private lastPollSummary: AccessPollResult | null = null;

  constructor(
    private readonly accessConfig: AccessConfig,
    logger: FastifyBaseLogger,
    private readonly ingressEventDispatcher: IngressEventDispatcher
  ) {
    this.logger = logger.child({ service: 'accessIngest' });
  }

  start(): void {
    if (!this.accessConfig.enabled) {
      this.logger.info('Access ingest disabled in config.');
      return;
    }

    if (this.accessConfig.backgroundPollingEnabled) {
      try {
        this.startBackgroundPolling();
      } catch (error) {
        this.logger.warn(
          {
            err: error
          },
          'Access background polling was requested in config but service is not fully configured.'
        );
      }
      return;
    }

    this.logger.info('Access ingest ready for manual polling; background polling disabled in config.');
  }

  stop(): void {
    this.stopBackgroundPolling();
  }

  async listUsers() {
    return db.select().from(accessUsers).orderBy(asc(accessUsers.name), asc(accessUsers.id));
  }

  async listDoors() {
    return db.select().from(accessDoors).orderBy(asc(accessDoors.name), asc(accessDoors.id));
  }

  async getIngestState(): Promise<AccessCursorState> {
    return this.ensureIngestState();
  }

  getPollStatus(): AccessPollStatus {
    return {
      enabled: this.accessConfig.enabled,
      configuredApiBaseUrl: this.accessConfig.apiBaseUrl,
      pollIntervalMs: this.accessConfig.pollIntervalMs,
      backgroundPollingConfigured: this.accessConfig.backgroundPollingEnabled,
      backgroundPollingRunning: this.backgroundPollingRunning,
      pollInFlight: this.pollPromise !== null,
      lastPollStartedAt: this.lastPollStartedAt,
      lastPollCompletedAt: this.lastPollCompletedAt,
      lastPollError: this.lastPollError,
      lastPollSummary: this.lastPollSummary
    };
  }

  startBackgroundPolling(): AccessPollStatus {
    this.assertConfigured();

    if (this.backgroundPollingRunning) {
      return this.getPollStatus();
    }

    this.backgroundPollingRunning = true;
    this.logger.info(
      {
        pollIntervalMs: this.accessConfig.pollIntervalMs,
        topic: ACCESS_LOG_TOPIC
      },
      'Access background polling started.'
    );
    this.scheduleNextPoll(0);
    return this.getPollStatus();
  }

  stopBackgroundPolling(): AccessPollStatus {
    this.backgroundPollingRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    return this.getPollStatus();
  }

  async syncUsers(): Promise<AccessInventorySyncResult> {
    this.assertConfigured();

    const observedAt = new Date().toISOString();
    const response = await fetch(buildAccessUrl(this.accessConfig.apiBaseUrl, ACCESS_USERS_PATH), {
      method: 'GET',
      headers: this.buildHeaders()
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new Error(`Access users sync failed with HTTP ${response.status}: ${describeErrorBody(body)}`);
    }

    const records = extractRecordArray(body, ['users', 'data', 'items', 'results']);
    const mappedRecords = records
      .map((record) => mapUserRecord(record, observedAt))
      .filter((record): record is AccessUserUpsertRecord => record !== null);

    const ids = mappedRecords.map((record) => record.id);
    const existingRows = ids.length > 0
      ? await db.select({ id: accessUsers.id }).from(accessUsers).where(inArray(accessUsers.id, ids))
      : [];
    const existingIds = new Set(existingRows.map((row) => row.id));

    const upsert = rawDb.prepare(`
      INSERT INTO access_users (id, name, raw_json, last_seen_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        raw_json = excluded.raw_json,
        last_seen_at = excluded.last_seen_at
    `);

    const transaction = rawDb.transaction((rows: AccessUserUpsertRecord[]) => {
      for (const row of rows) {
        upsert.run(row.id, row.name, row.rawJson, row.lastSeenAt);
      }
    });

    transaction(mappedRecords);

    const totals = await db.select({ total: count() }).from(accessUsers);
    const inserted = mappedRecords.filter((record) => !existingIds.has(record.id)).length;
    const result = {
      fetched: records.length,
      inserted,
      updated: mappedRecords.length - inserted,
      skipped: records.length - mappedRecords.length,
      totalKnown: totals[0]?.total ?? 0
    };

    this.logger.info(result, 'Access users sync completed.');
    return result;
  }

  async syncDoors(): Promise<AccessInventorySyncResult> {
    this.assertConfigured();

    const observedAt = new Date().toISOString();
    const response = await fetch(buildAccessUrl(this.accessConfig.apiBaseUrl, ACCESS_DOORS_PATH), {
      method: 'GET',
      headers: this.buildHeaders()
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new Error(`Access doors sync failed with HTTP ${response.status}: ${describeErrorBody(body)}`);
    }

    const records = extractRecordArray(body, ['doors', 'data', 'items', 'results']);
    const mappedRecords = records
      .map((record) => mapDoorRecord(record, observedAt))
      .filter((record): record is AccessDoorUpsertRecord => record !== null);

    const ids = mappedRecords.map((record) => record.id);
    const existingRows = ids.length > 0
      ? await db.select({ id: accessDoors.id }).from(accessDoors).where(inArray(accessDoors.id, ids))
      : [];
    const existingIds = new Set(existingRows.map((row) => row.id));

    const upsert = rawDb.prepare(`
      INSERT INTO access_doors (id, name, full_name, raw_json, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        full_name = excluded.full_name,
        raw_json = excluded.raw_json,
        last_seen_at = excluded.last_seen_at
    `);

    const transaction = rawDb.transaction((rows: AccessDoorUpsertRecord[]) => {
      for (const row of rows) {
        upsert.run(row.id, row.name, row.fullName, row.rawJson, row.lastSeenAt);
      }
    });

    transaction(mappedRecords);

    const totals = await db.select({ total: count() }).from(accessDoors);
    const inserted = mappedRecords.filter((record) => !existingIds.has(record.id)).length;
    const result = {
      fetched: records.length,
      inserted,
      updated: mappedRecords.length - inserted,
      skipped: records.length - mappedRecords.length,
      totalKnown: totals[0]?.total ?? 0
    };

    this.logger.info(result, 'Access doors sync completed.');
    return result;
  }

  async pollLogs(): Promise<AccessPollResult> {
    if (this.pollPromise) {
      return this.pollPromise;
    }

    const pollPromise = this.performPoll().finally(() => {
      if (this.pollPromise === pollPromise) {
        this.pollPromise = null;
      }
    });

    this.pollPromise = pollPromise;
    return pollPromise;
  }

  private async performPoll(): Promise<AccessPollResult> {
    this.assertConfigured();

    const receivedAt = new Date().toISOString();
    this.lastPollStartedAt = receivedAt;
    this.lastPollError = null;

    const previousCursor = await this.ensureIngestState();
    const response = await fetch(buildAccessLogsUrl(this.accessConfig.apiBaseUrl), {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(buildAccessLogsRequestBody())
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      const errorMessage = `Access log poll failed with HTTP ${response.status}: ${describeErrorBody(body)}`;
      this.lastPollError = errorMessage;
      throw new Error(errorMessage);
    }

    let records: unknown[];
    try {
      records = extractRecordArray(body, ['data.hits', 'hits.hits', 'logs', 'data', 'items', 'results']);
    } catch (error) {
      this.logger.warn(
        {
          responseShape: describeLogResponseShape(body, response.status)
        },
        'Access log response shape was unexpected.'
      );
      throw error;
    }

    const normalizedRecords = records.map((record) => normalizeAccessLogRecord(record, receivedAt));
    for (const record of normalizedRecords) {
      if (!record.doorTargetFound) {
        this.logger.warn(
          {
            eventId: record.eventId,
            stableEventId: record.stableEventId,
            timestamp: record.timestamp,
            eventType: record.eventType
          },
          'Access log record did not contain a door target.'
        );
      }
    }

    const inputOrderedAscending = this.isOrdered(normalizedRecords, 'asc');
    const inputOrderedDescending = this.isOrdered(normalizedRecords, 'desc');
    const sortedRecords = [...normalizedRecords].sort((left, right) => {
      const timestampComparison = left.timestamp.localeCompare(right.timestamp);
      if (timestampComparison !== 0) {
        return timestampComparison;
      }

      const eventComparison = left.eventId.localeCompare(right.eventId);
      if (eventComparison !== 0) {
        return eventComparison;
      }

      return 0;
    });

    let processed = 0;
    let skipped = 0;
    let skippedDuplicates = 0;
    let latencyMsMin = Number.POSITIVE_INFINITY;
    let latencyMsMax = 0;
    let latencyMsTotal = 0;
    let nextCursorTimestamp = previousCursor.lastTimestamp;
    let nextCursorEventId = previousCursor.lastEventId;

    for (const record of sortedRecords) {
      const isOlderThanCursor = !!previousCursor.lastTimestamp && record.timestamp < previousCursor.lastTimestamp;
      const isBoundaryDuplicate = (
        previousCursor.lastTimestamp !== null
        && previousCursor.lastEventId !== null
        && record.timestamp === previousCursor.lastTimestamp
        && record.eventId === previousCursor.lastEventId
      );

      if (isOlderThanCursor) {
        skipped += 1;
        continue;
      }

      if (isBoundaryDuplicate) {
        skipped += 1;
        skippedDuplicates += 1;
        continue;
      }

      await this.ingressEventDispatcher.publish(record.normalizedEvent);
      this.logger.info(
        {
          eventId: record.eventId,
          eventIdKind: record.eventIdKind,
          normalizedEvent: record.normalizedEvent
        },
        'Access normalized event published.'
      );

      processed += 1;
      latencyMsMin = Math.min(latencyMsMin, record.processingLatencyMs);
      latencyMsMax = Math.max(latencyMsMax, record.processingLatencyMs);
      latencyMsTotal += record.processingLatencyMs;
      nextCursorTimestamp = record.timestamp;
      nextCursorEventId = record.eventId;
    }

    if (processed > 0) {
      await this.persistIngestState(nextCursorTimestamp, nextCursorEventId);
    }

    const currentCursor = processed > 0
      ? { lastTimestamp: nextCursorTimestamp, lastEventId: nextCursorEventId }
      : { lastTimestamp: previousCursor.lastTimestamp, lastEventId: previousCursor.lastEventId };
    const timestamps = normalizedRecords.map((record) => record.timestamp);
    const uniqueTimestampCount = new Set(timestamps).size;
    const stableEventIdsObserved = normalizedRecords.filter((record) => record.eventIdKind === 'stable').length;
    const fingerprintEventIdsObserved = normalizedRecords.length - stableEventIdsObserved;
    const credentialProvidersObserved = [...new Set(
      normalizedRecords
        .map((record) => record.credentialProvider)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )].sort((left, right) => left.localeCompare(right));

    const result: AccessPollResult = {
      fetched: normalizedRecords.length,
      processed,
      skipped,
      skippedDuplicates,
      oldestTimestamp: timestamps.length > 0 ? [...timestamps].sort((left, right) => left.localeCompare(right))[0] : null,
      newestTimestamp: timestamps.length > 0 ? [...timestamps].sort((left, right) => left.localeCompare(right)).slice(-1)[0] : null,
      latencyMsMin: processed > 0 ? latencyMsMin : 0,
      latencyMsMax: processed > 0 ? latencyMsMax : 0,
      latencyMsAvg: processed > 0 ? Math.round(latencyMsTotal / processed) : 0,
      latencySampleCount: processed,
      inputOrderedAscending,
      inputOrderedDescending,
      uniqueTimestampCount,
      duplicateTimestampCount: timestamps.length - uniqueTimestampCount,
      stableEventIdsObserved,
      fingerprintEventIdsObserved,
      credentialProvidersObserved,
      cursor: currentCursor
    };

    this.lastPollCompletedAt = new Date().toISOString();
    this.lastPollSummary = result;

    this.logger.info(
      {
        topic: ACCESS_LOG_TOPIC,
        summary: result
      },
      'Access log poll completed.'
    );

    return result;
  }

  private buildHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      Authorization: `Bearer ${this.accessConfig.apiKey}`
    };
  }

  private assertConfigured(): void {
    if (!this.accessConfig.enabled) {
      throw new Error('Access ingest is disabled.');
    }

    if (!this.accessConfig.apiBaseUrl) {
      throw new Error('Access API base URL is not configured.');
    }

    if (!this.accessConfig.apiKey) {
      throw new Error('Access API key is not configured.');
    }
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.backgroundPollingRunning) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.runBackgroundPoll();
    }, delayMs);
  }

  private async runBackgroundPoll(): Promise<void> {
    try {
      await this.pollLogs();
    } catch (error) {
      this.lastPollCompletedAt = new Date().toISOString();
      this.lastPollError = (error as Error).message;
      this.logger.warn(
        {
          err: error
        },
        'Access background poll failed.'
      );
    } finally {
      this.scheduleNextPoll(this.accessConfig.pollIntervalMs);
    }
  }

  private async ensureIngestState(): Promise<AccessCursorState> {
    rawDb.prepare(`
      INSERT INTO access_ingest_state (id, last_timestamp, last_event_id, updated_at)
      VALUES (1, NULL, NULL, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(new Date().toISOString());

    const row = await db
      .select({
        lastTimestamp: accessIngestState.lastTimestamp,
        lastEventId: accessIngestState.lastEventId,
        updatedAt: accessIngestState.updatedAt
      })
      .from(accessIngestState)
      .where(eq(accessIngestState.id, 1))
      .limit(1);

    return row[0] ?? {
      lastTimestamp: null,
      lastEventId: null,
      updatedAt: new Date().toISOString()
    };
  }

  private async persistIngestState(lastTimestamp: string | null, lastEventId: string | null): Promise<void> {
    const updatedAt = new Date().toISOString();

    rawDb.prepare(`
      INSERT INTO access_ingest_state (id, last_timestamp, last_event_id, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_timestamp = excluded.last_timestamp,
        last_event_id = excluded.last_event_id,
        updated_at = excluded.updated_at
    `).run(lastTimestamp, lastEventId, updatedAt);
  }

  private isOrdered(records: AccessLogRecord[], direction: 'asc' | 'desc'): boolean {
    for (let index = 1; index < records.length; index += 1) {
      const previous = records[index - 1].timestamp;
      const current = records[index].timestamp;

      if (direction === 'asc' && previous > current) {
        return false;
      }

      if (direction === 'desc' && previous < current) {
        return false;
      }
    }

    return true;
  }
}
