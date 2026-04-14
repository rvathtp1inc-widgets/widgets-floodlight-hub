import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config();

const defaultCloudConfigPath = process.env.FLOODLIGHT_HUB_CONFIG_PATH ?? '/usr/local/widgets-data/floodlighthub.json';

export interface DeviceConfig {
  serialNumber: string;
  deviceSecret: string;
  model: string;
}

export interface CloudConfig {
  enabled: boolean;
  apiBaseUrl: string;
  heartbeatIntervalSeconds: number;
}

interface ProvisioningConfigFile {
  device?: {
    serialNumber?: unknown;
    deviceSecret?: unknown;
    model?: unknown;
  };
  cloud?: {
    enabled?: unknown;
    apiBaseUrl?: unknown;
    heartbeatIntervalSeconds?: unknown;
  };
}

function readNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadProvisioningConfig(configPath: string) {
  const warnings: string[] = [];
  const device: DeviceConfig = {
    serialNumber: '',
    deviceSecret: '',
    model: 'widgets-floodlight-hub'
  };
  const cloud: CloudConfig = {
    enabled: false,
    apiBaseUrl: 'https://api.widgetsinc.io',
    heartbeatIntervalSeconds: 60
  };

  if (!fs.existsSync(configPath)) {
    warnings.push(`Cloud config file not found at ${configPath}; cloud integration is disabled until provisioned.`);
    return { device, cloud, warnings };
  }

  let parsed: ProvisioningConfigFile;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProvisioningConfigFile;
  } catch (error) {
    warnings.push(`Cloud config file at ${configPath} could not be parsed: ${(error as Error).message}`);
    return { device, cloud, warnings };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(`Cloud config file at ${configPath} must contain a JSON object.`);
    return { device, cloud, warnings };
  }

  if (parsed.device?.serialNumber === undefined || typeof parsed.device.serialNumber === 'string') {
    device.serialNumber = parsed.device?.serialNumber?.trim() ?? '';
  } else {
    warnings.push(`Invalid device.serialNumber in ${configPath}; expected a string.`);
  }

  if (parsed.device?.deviceSecret === undefined || typeof parsed.device.deviceSecret === 'string') {
    device.deviceSecret = parsed.device?.deviceSecret?.trim() ?? '';
  } else {
    warnings.push(`Invalid device.deviceSecret in ${configPath}; expected a string.`);
  }

  if (parsed.device?.model === undefined || typeof parsed.device.model === 'string') {
    device.model = parsed.device?.model?.trim() || device.model;
  } else {
    warnings.push(`Invalid device.model in ${configPath}; expected a string.`);
  }

  if (parsed.cloud?.enabled === undefined || typeof parsed.cloud.enabled === 'boolean') {
    cloud.enabled = parsed.cloud?.enabled ?? cloud.enabled;
  } else {
    warnings.push(`Invalid cloud.enabled in ${configPath}; expected a boolean.`);
  }

  if (parsed.cloud?.apiBaseUrl === undefined || typeof parsed.cloud.apiBaseUrl === 'string') {
    const apiBaseUrl = parsed.cloud?.apiBaseUrl?.trim();
    cloud.apiBaseUrl = apiBaseUrl || cloud.apiBaseUrl;
  } else {
    warnings.push(`Invalid cloud.apiBaseUrl in ${configPath}; expected a string.`);
  }

  if (parsed.cloud?.heartbeatIntervalSeconds === undefined || typeof parsed.cloud.heartbeatIntervalSeconds === 'number') {
    const interval = parsed.cloud?.heartbeatIntervalSeconds;
    if (interval !== undefined && Number.isFinite(interval) && interval > 0) {
      cloud.heartbeatIntervalSeconds = Math.floor(interval);
    } else if (interval !== undefined) {
      warnings.push(`Invalid cloud.heartbeatIntervalSeconds in ${configPath}; expected a positive number.`);
    }
  } else {
    warnings.push(`Invalid cloud.heartbeatIntervalSeconds in ${configPath}; expected a number.`);
  }

  return { device, cloud, warnings };
}

const provisioningConfig = loadProvisioningConfig(defaultCloudConfigPath);

export const config = {
  port: readNumber(process.env.PORT, 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/widgets-hub.db',
  encryptionKey: process.env.APP_ENCRYPTION_KEY ?? 'dev-only-key-change-me',
  timerPollSeconds: readNumber(process.env.TIMER_POLL_SECONDS, 5),
  requestTimeoutMs: readNumber(process.env.REQUEST_TIMEOUT_MS, 5000),
  cloudConfigPath: defaultCloudConfigPath,
  device: provisioningConfig.device,
  cloud: provisioningConfig.cloud,
  configWarnings: provisioningConfig.warnings
};
