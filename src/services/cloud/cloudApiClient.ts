import { CloudConfig, DeviceConfig } from '../../config.js';

export interface CloudHeartbeatPayload {
  deviceId: string;
  status: 'online';
  observedAt: string;
}

export interface BootstrapResponse {
  deviceId: string;
  [key: string]: unknown;
}

export class CloudApiError extends Error {
  constructor(
    public readonly operation: 'bootstrap' | 'heartbeat',
    public readonly status: number,
    public readonly responseBody: unknown
  ) {
    super(`${operation} failed with HTTP ${status}: ${describeErrorBody(responseBody)}`);
    this.name = 'CloudApiError';
  }
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    return text ? { raw: text } : {};
  }

  return response.json();
}

function buildCloudUrl(apiBaseUrl: string, path: string): URL {
  const normalizedBaseUrl = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
  return new URL(path, normalizedBaseUrl);
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

export class CloudApiClient {
  constructor(private readonly cloudConfig: CloudConfig) {}

  async bootstrap(device: DeviceConfig): Promise<BootstrapResponse> {
    const response = await fetch(buildCloudUrl(this.cloudConfig.apiBaseUrl, 'devices/bootstrap'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serialNumber: device.serialNumber,
        deviceSecret: device.deviceSecret,
        model: 'widgets-floodlight-hub',
        firmwareVersion: '0.1.0'
      })
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new CloudApiError('bootstrap', response.status, body);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Bootstrap response was not a JSON object.');
    }

    if (typeof (body as { deviceId?: unknown }).deviceId !== 'string' || !(body as { deviceId: string }).deviceId.trim()) {
      throw new Error('Bootstrap response did not include a valid deviceId.');
    }

    return body as BootstrapResponse;
  }

  async heartbeat(payload: CloudHeartbeatPayload): Promise<Record<string, unknown>> {
    const response = await fetch(buildCloudUrl(this.cloudConfig.apiBaseUrl, 'devices/heartbeat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new CloudApiError('heartbeat', response.status, body);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }

    return body as Record<string, unknown>;
  }
}
