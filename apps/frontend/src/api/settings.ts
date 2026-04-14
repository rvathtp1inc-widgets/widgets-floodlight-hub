import axios from 'axios';

const api = axios.create({ baseURL: '' });

export type HubSettings = {
  id: number;
  timezone: string;
  latitude: string | null;
  longitude: string | null;
  astroEnabled: boolean;
  defaultWebhookHeaderName: string;
  uiSessionTimeoutMinutes: number;
  logRetentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type HubSettingsPatch = Partial<
  Pick<HubSettings, 'timezone' | 'latitude' | 'longitude' | 'astroEnabled' | 'defaultWebhookHeaderName'>
>;

export async function fetchSettings(): Promise<HubSettings> {
  const { data } = await api.get<HubSettings>('/api/settings');
  return data;
}

export async function updateSettings(input: HubSettingsPatch): Promise<HubSettings> {
  const { data } = await api.patch<HubSettings>('/api/settings', input);
  return data;
}
