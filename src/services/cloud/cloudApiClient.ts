import { CloudConfig, DeviceConfig } from '../../config.js';

export interface CloudHeartbeatPayload {
  serialNumber: string;
  model: string;
  cloudIdentity: Record<string, unknown>;
  sentAt: string;
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

export class CloudApiClient {
  constructor(private readonly cloudConfig: CloudConfig) {}

  async bootstrap(device: DeviceConfig): Promise<Record<string, unknown>> {
    const response = await fetch(buildCloudUrl(this.cloudConfig.apiBaseUrl, 'devices/bootstrap'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        serialNumber: device.serialNumber,
        deviceSecret: device.deviceSecret,
        model: device.model
      })
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new Error(`Bootstrap failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Bootstrap response was not a JSON object.');
    }

    return body as Record<string, unknown>;
  }

  async heartbeat(payload: CloudHeartbeatPayload): Promise<Record<string, unknown>> {
    const response = await fetch(buildCloudUrl(this.cloudConfig.apiBaseUrl, 'devices/heartbeat'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const body = await parseJsonBody(response);
    if (!response.ok) {
      throw new Error(`Heartbeat failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {};
    }

    return body as Record<string, unknown>;
  }
}
