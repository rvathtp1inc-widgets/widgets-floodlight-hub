import { FastifyBaseLogger } from 'fastify';
import WebSocket, { RawData } from 'ws';
import { ProtectApiConfig } from '../../config.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';
import { ProtectSourceResolutionContext } from '../ingress/normalizedEvent.js';
import {
  normalizeProtectApiEvent,
  ProtectApiEventEnvelope,
  ResolvedNormalizedProtectApiEvent
} from './normalizeProtectApiEvent.js';
import { loadPersistedProtectApiConfig } from './protectApiSettings.js';
import { ProtectSourceSyncService } from './protectSourceSyncService.js';

const PROTECT_API_EVENTS_PATH = '/proxy/protect/integration/v1/subscribe/events';
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

interface ProtectApiIngestStatus {
  enabled: boolean;
  connected: boolean;
  configuredBaseUrl: string;
  reconnectAttempts: number;
}

function buildEventStreamUrl(baseUrl: string): string {
  const url = new URL(baseUrl);

  if (url.protocol === 'https:') {
    url.protocol = 'wss:';
  } else if (url.protocol === 'http:') {
    url.protocol = 'ws:';
  }

  url.pathname = PROTECT_API_EVENTS_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function getReconnectDelayMs(attempt: number): number {
  return Math.min(INITIAL_RECONNECT_DELAY_MS * (2 ** Math.max(attempt - 1, 0)), MAX_RECONNECT_DELAY_MS);
}

function toUtf8(message: RawData): string {
  if (typeof message === 'string') return message;
  if (message instanceof Buffer) return message.toString('utf8');
  if (Array.isArray(message)) return Buffer.concat(message).toString('utf8');
  return Buffer.from(new Uint8Array(message)).toString('utf8');
}

// Protect API websocket ingest is viable for real-time camera-level diagnostics.
// Confirmed observed payloads provide item.device camera mapping, add/update lifecycle,
// event classes for zone/line/motion/audio, and smartDetectTypes classifications.
// Observed payloads did not include named smart-zone identity, named line identity,
// or line direction, so webhook ingest remains necessary for that specificity.
export class ProtectApiIngestService {
  private readonly logger: FastifyBaseLogger;
  private readonly status: ProtectApiIngestStatus;
  private socket?: WebSocket;
  private reconnectTimeout?: NodeJS.Timeout;
  private stopped = false;
  private protectApiConfig: ProtectApiConfig = { enabled: false, baseUrl: '', apiKey: '' };

  constructor(
    logger: FastifyBaseLogger,
    private readonly protectSourceSyncService: ProtectSourceSyncService,
    private readonly ingressEventDispatcher: IngressEventDispatcher,
    private readonly loadProtectApiConfig: () => Promise<ProtectApiConfig> = loadPersistedProtectApiConfig
  ) {
    this.logger = logger.child({ service: 'protectApiIngest' });
    this.status = {
      enabled: false,
      connected: false,
      configuredBaseUrl: '',
      reconnectAttempts: 0
    };
  }

  async start(): Promise<void> {
    this.protectApiConfig = await this.loadProtectApiConfig();
    this.status.enabled = this.protectApiConfig.enabled;
    this.status.configuredBaseUrl = this.protectApiConfig.baseUrl;

    if (!this.protectApiConfig.enabled) {
      this.logger.info('Protect API ingest disabled in persisted settings.');
      return;
    }

    if (!this.protectApiConfig.baseUrl) {
      this.logger.warn('Protect API ingest enabled, but protectApi.baseUrl is empty. Service will not start.');
      return;
    }

    if (!this.protectApiConfig.apiKey) {
      this.logger.warn('Protect API ingest enabled, but protectApi.apiKey is empty. Service will not start.');
      return;
    }

    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = undefined;

    const socket = this.socket;
    this.socket = undefined;
    this.status.connected = false;

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      socket.removeAllListeners();
      socket.close();
    }
  }

  getStatus(): ProtectApiIngestStatus {
    return { ...this.status };
  }

  private connect(): void {
    if (this.stopped) return;

    let url: string;
    try {
      url = buildEventStreamUrl(this.protectApiConfig.baseUrl);
    } catch (error) {
      this.logger.error(
        {
          configuredBaseUrl: this.protectApiConfig.baseUrl,
          err: error
        },
        'Protect API websocket connect failed due to invalid base URL.'
      );
      return;
    }

    this.logger.info({ url }, 'Protect API websocket connect starting.');

    const socket = new WebSocket(url, {
      headers: {
        'X-API-KEY': this.protectApiConfig.apiKey
      }
    });

    this.socket = socket;

    socket.on('open', () => {
      this.status.connected = true;
      this.status.reconnectAttempts = 0;
      this.logger.info(
        {
          url,
          limitation: 'Named smart-zone identity and named line identity/direction were not observed in websocket payloads.'
        },
        'Protect API websocket connected.'
      );
    });

    socket.on('message', (message) => {
      void this.handleMessage(message);
    });

    socket.on('close', (code, reason) => {
      this.status.connected = false;
      if (this.socket === socket) {
        this.socket = undefined;
      }

      const reasonText = reason.toString('utf8');
      this.logger.warn(
        {
          code,
          reason: reasonText || null
        },
        'Protect API websocket disconnected.'
      );

      this.scheduleReconnect();
    });

    socket.on('error', (error) => {
      this.logger.warn({ err: error }, 'Protect API websocket error.');
    });
  }

  private async handleMessage(message: RawData): Promise<void> {
    const rawMessage = toUtf8(message);
    let parsed: ProtectApiEventEnvelope;

    try {
      parsed = JSON.parse(rawMessage) as ProtectApiEventEnvelope;
    } catch (error) {
      this.logger.warn(
        {
          rawMessage,
          err: error
        },
        'Protect API websocket parse failure.'
      );
      return;
    }

    const normalized = normalizeProtectApiEvent(parsed);
    const lifecycle = typeof parsed.type === 'string' ? parsed.type : 'unknown';

    this.logger.info(
      {
        lifecycle,
        rawEvent: parsed
      },
      'Protect API raw event received.'
    );

    const resolvedSource = await this.resolveProtectSource(normalized.cameraId, normalized.timestamp);
    const normalizedEvent: ResolvedNormalizedProtectApiEvent = {
      ...normalized,
      resolvedSource,
      lifecycle
    };

    if (resolvedSource) {
      this.logger.info(
        {
          lifecycle,
          normalizedEvent,
          sourceResolution: {
            status: 'resolved',
            sourceType: resolvedSource.sourceType,
            sourceId: resolvedSource.sourceId
          }
        },
        'Protect API source resolved before unified ingress publish.'
      );
    } else {
      this.logger.warn(
        {
          lifecycle,
          normalizedEvent,
          sourceResolution: {
            status: 'unresolved',
            protectCameraId: normalized.cameraId,
            reason: normalized.cameraId ? 'protect_source_not_found' : 'camera_id_missing'
          }
        },
        'Protect API source unresolved before unified ingress publish.'
      );
    }

    await this.ingressEventDispatcher.publish(normalizedEvent);
  }

  private async resolveProtectSource(
    cameraId: string | null,
    eventTimestamp: string
  ): Promise<ProtectSourceResolutionContext | null> {
    if (!cameraId) {
      return null;
    }

    try {
      const resolvedSource = await this.protectSourceSyncService.resolveSourceByCameraId(cameraId);
      if (!resolvedSource) {
        return null;
      }

      await this.protectSourceSyncService.markSourceEventSeen(resolvedSource.sourceId, eventTimestamp);

      return {
        ...resolvedSource,
        lastEventSeenAt: eventTimestamp
      };
    } catch (error) {
      this.logger.warn(
        {
          protectCameraId: cameraId,
          eventTimestamp,
          err: error
        },
        'Protect API source resolution failed; continuing ingest without resolved source.'
      );
      return null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (!this.protectApiConfig.enabled) return;
    if (this.reconnectTimeout) return;

    this.status.reconnectAttempts += 1;
    const delayMs = getReconnectDelayMs(this.status.reconnectAttempts);

    this.logger.info(
      {
        reconnectAttempt: this.status.reconnectAttempts,
        delayMs
      },
      'Protect API websocket reconnect scheduled.'
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = undefined;
      this.connect();
    }, delayMs);
  }
}
