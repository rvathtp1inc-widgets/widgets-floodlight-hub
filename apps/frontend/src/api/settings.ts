import axios from 'axios';

const api = axios.create({ baseURL: '' });

export type HubSettings = {
  id: number;
  timezone: string;
  latitude: string | null;
  longitude: string | null;
  astroEnabled: boolean;
  defaultWebhookHeaderName: string;
  protectApiEnabled: boolean;
  protectConsoleHost: string | null;
  hasProtectApiKey: boolean;
  uiSessionTimeoutMinutes: number;
  logRetentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type HubSettingsPatch = Partial<
  Pick<
    HubSettings,
    'timezone' | 'latitude' | 'longitude' | 'astroEnabled' | 'defaultWebhookHeaderName' | 'protectApiEnabled' | 'protectConsoleHost'
  >
> & {
  protectApiKey?: string;
};

export type ProtectSourceSyncResult = {
  inserted?: number;
  updated?: number;
  skipped?: number;
  totalKnownSources?: number;
};

export async function fetchSettings(): Promise<HubSettings> {
  const { data } = await api.get<HubSettings>('/api/settings');
  return data;
}

export async function updateSettings(input: HubSettingsPatch): Promise<HubSettings> {
  const { data } = await api.patch<HubSettings>('/api/settings', input);
  return data;
}

export async function syncProtectSources(): Promise<ProtectSourceSyncResult> {
  const { data } = await api.post<ProtectSourceSyncResult>('/api/protect/sources/sync');
  return data;
}
