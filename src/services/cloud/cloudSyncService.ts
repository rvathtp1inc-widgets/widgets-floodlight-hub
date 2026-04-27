import { DateTime } from 'luxon';
import { FastifyBaseLogger } from 'fastify';
import { CloudConfig, DeviceConfig } from '../../config.js';
import { CloudApiClient, CloudApiError } from './cloudApiClient.js';

export interface CloudStatusSnapshot {
  enabled: boolean;
  identityConfigured: boolean;
  configuredApiBaseUrl: string;
  heartbeatIntervalSeconds: number;
  bootstrap: {
    state: 'disabled' | 'not_configured' | 'idle' | 'success' | 'failure';
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  heartbeat: {
    state: 'idle' | 'success' | 'failure';
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastError: string | null;
  };
  runtimeIdentity: Record<string, unknown> | null;
}

export class CloudSyncService {
  private readonly client: CloudApiClient;
  private readonly status: CloudStatusSnapshot;
  private timeout?: NodeJS.Timeout;
  private stopped = false;
  private runtimeDeviceId: string | null = null;

  constructor(
    private readonly cloudConfig: CloudConfig,
    private readonly deviceConfig: DeviceConfig,
    private readonly logger: FastifyBaseLogger
  ) {
    this.client = new CloudApiClient(cloudConfig);
    this.status = {
      enabled: cloudConfig.enabled,
      identityConfigured: Boolean(deviceConfig.serialNumber && deviceConfig.deviceSecret),
      configuredApiBaseUrl: cloudConfig.apiBaseUrl,
      heartbeatIntervalSeconds: cloudConfig.heartbeatIntervalSeconds,
      bootstrap: {
        state: cloudConfig.enabled ? 'idle' : 'disabled',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null
      },
      heartbeat: {
        state: 'idle',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastError: null
      },
      runtimeIdentity: null
    };
  }

  start(): void {
    if (!this.cloudConfig.enabled) {
      this.logger.info('Cloud integration disabled in provisioning config.');
      this.status.bootstrap.state = 'disabled';
      return;
    }

    if (!this.status.identityConfigured) {
      this.logger.warn('Cloud integration enabled, but device.serialNumber or device.deviceSecret is missing. Continuing with local-only startup.');
      this.status.bootstrap.state = 'not_configured';
      return;
    }

    this.schedule(() => this.runBootstrap(), 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
  }

  getStatus(): CloudStatusSnapshot {
    return {
      ...this.status,
      bootstrap: { ...this.status.bootstrap },
      heartbeat: { ...this.status.heartbeat },
      runtimeIdentity: this.status.runtimeIdentity ? { ...this.status.runtimeIdentity } : null
    };
  }

  private schedule(task: () => Promise<void>, delayMs: number): void {
    if (this.stopped) return;
    if (this.timeout) clearTimeout(this.timeout);

    this.timeout = setTimeout(() => {
      void task();
    }, delayMs);
  }

  private getErrorDetails(error: unknown): { status: number | null; message: string; responseBody: unknown | null } {
    if (error instanceof CloudApiError) {
      return { status: error.status, message: error.message, responseBody: error.responseBody };
    }

    return {
      status: null,
      message: error instanceof Error ? error.message : String(error),
      responseBody: null
    };
  }

  private async runBootstrap(): Promise<void> {
    if (this.stopped) return;

    this.status.bootstrap.lastAttemptAt = DateTime.utc().toISO();
    this.logger.info(
      {
        serialNumber: this.deviceConfig.serialNumber,
        firmwareVersion: this.deviceConfig.firmwareVersion
      },
      'Cloud bootstrap starting.'
    );

    try {
      const runtimeIdentity = await this.client.bootstrap(this.deviceConfig);
      this.runtimeDeviceId = runtimeIdentity.deviceId;
      this.status.runtimeIdentity = runtimeIdentity;
      this.status.bootstrap.state = 'success';
      this.status.bootstrap.lastSuccessAt = DateTime.utc().toISO();
      this.status.bootstrap.lastError = null;
      this.logger.info(
        {
          serialNumber: this.deviceConfig.serialNumber,
          deviceId: this.runtimeDeviceId
        },
        'Cloud bootstrap success'
      );
      this.logger.info('Starting heartbeat loop');
      this.schedule(() => this.runHeartbeat(), this.cloudConfig.heartbeatIntervalSeconds * 1000);
    } catch (error) {
      const { status, message } = this.getErrorDetails(error);
      this.status.bootstrap.state = 'failure';
      this.status.bootstrap.lastError = message;
      this.logger.warn(
        {
          status,
          message
        },
        'Cloud bootstrap failure'
      );
      this.schedule(() => this.runBootstrap(), this.cloudConfig.heartbeatIntervalSeconds * 1000);
    }
  }

  private async runHeartbeat(): Promise<void> {
    if (this.stopped) return;

    if (!this.status.runtimeIdentity) {
      this.logger.warn('Cloud heartbeat skipped because no runtime cloud identity is available; retrying bootstrap.');
      this.schedule(() => this.runBootstrap(), 0);
      return;
    }

    if (!this.runtimeDeviceId) {
      this.logger.warn(
        { serialNumber: this.deviceConfig.serialNumber },
        'Cloud heartbeat skipped because bootstrap deviceId is missing'
      );
      this.schedule(() => this.runBootstrap(), 0);
      return;
    }

    this.status.heartbeat.lastAttemptAt = DateTime.utc().toISO();
    this.logger.info({ deviceId: this.runtimeDeviceId }, 'Heartbeat starting');

    try {
      const response = await this.client.heartbeat({
        deviceId: this.runtimeDeviceId,
        status: 'online',
        observedAt: new Date().toISOString()
      });

      this.status.runtimeIdentity = { ...this.status.runtimeIdentity, ...response };
      this.status.heartbeat.state = 'success';
      this.status.heartbeat.lastSuccessAt = DateTime.utc().toISO();
      this.status.heartbeat.lastError = null;
      this.logger.info({ deviceId: this.runtimeDeviceId }, 'Heartbeat success');
      this.schedule(() => this.runHeartbeat(), this.cloudConfig.heartbeatIntervalSeconds * 1000);
    } catch (error) {
      const { status, message } = this.getErrorDetails(error);
      this.status.heartbeat.state = 'failure';
      this.status.heartbeat.lastError = message;
      this.logger.warn(
        {
          status,
          message,
          deviceId: this.runtimeDeviceId
        },
        'Heartbeat failure'
      );
      this.schedule(() => this.runHeartbeat(), this.cloudConfig.heartbeatIntervalSeconds * 1000);
    }
  }
}
