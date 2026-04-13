import axios from 'axios';

export type ScheduleMode = 'always' | 'fixed_window' | 'sunset_to_sunrise' | 'astro_offset';
export type ManualOverrideMode = 'none' | 'force_on' | 'force_off' | 'suspended';

export type FixedWindowSchedule = {
  start: string;
  end: string;
};

export type AstroOffsetSchedule = {
  sunsetOffsetMinutes: number;
  sunriseOffsetMinutes: number;
};

export type ScheduleJson = Record<string, unknown>;

export type Floodlight = {
  id: number;
  name: string;
  shellyHost: string;
  shellyPort: number;
  relayId: number;
  webhookKey: string | null;
  onlineStatus: string;
  lastKnownOutput: boolean | null;
  automationEnabled: boolean;
  manualOverrideMode: ManualOverrideMode;
  testModeEnabled: boolean;
  testModeUntil: string | null;
  scheduleMode: ScheduleMode;
  scheduleJson: string | ScheduleJson;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  autoOffSeconds: number;
  authEnabled: boolean;
  lastSeenAt: string | null;
  lastCommandStatus: string | null;
  hasSharedSecret: boolean;
  hasShellyPassword: boolean;
};

export type FloodlightUpsertInput = {
  name: string;
  shellyHost: string;
  shellyPort: number;
  relayId: number;
  authEnabled: boolean;
  shellyPassword?: string;
  webhookKey?: string;
  sharedSecret?: string;
  automationEnabled: boolean;
  manualOverrideMode: ManualOverrideMode;
  autoOffSeconds: number;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  testModeEnabled: boolean;
  scheduleMode: ScheduleMode;
  scheduleJson: ScheduleJson;
  clearSharedSecret?: boolean;
  clearShellyPassword?: boolean;
};

const api = axios.create({ baseURL: '' });

export function parseScheduleJson(value: Floodlight['scheduleJson']): ScheduleJson {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as ScheduleJson;
      return parsed;
    } catch {
      return {};
    }
  }

  return value ?? {};
}

export async function fetchFloodlights(): Promise<Floodlight[]> {
  const { data } = await api.get<Floodlight[]>('/api/floodlights');
  return data;
}

export async function createFloodlight(input: FloodlightUpsertInput): Promise<Floodlight> {
  const payload = {
    name: input.name,
    shellyHost: input.shellyHost,
    port: input.shellyPort,
    relayId: input.relayId,
    authEnabled: input.authEnabled,
    password: input.shellyPassword?.trim() || undefined,
    webhookKey: input.webhookKey || undefined,
    sharedSecret: input.sharedSecret?.trim() || undefined,
    automationEnabled: input.automationEnabled,
    manualOverrideMode: input.manualOverrideMode,
    autoOffSeconds: input.autoOffSeconds,
    retriggerMode: input.retriggerMode,
    debounceSeconds: input.debounceSeconds,
    cooldownSeconds: input.cooldownSeconds,
    testModeEnabled: input.testModeEnabled,
    scheduleMode: input.scheduleMode,
    scheduleJson: input.scheduleJson,
  };

  const { data } = await api.post<{ floodlight: Floodlight }>('/api/floodlights', payload);
  return data.floodlight;
}

export async function updateFloodlight(
  id: number,
  input: FloodlightUpsertInput,
): Promise<Floodlight> {
  const payload = {
    name: input.name,
    shellyHost: input.shellyHost,
    shellyPort: input.shellyPort,
    relayId: input.relayId,
    authEnabled: input.authEnabled,
    password: input.shellyPassword?.trim() || undefined,
    webhookKey: input.webhookKey || undefined,
    sharedSecret: input.sharedSecret?.trim() || undefined,
    automationEnabled: input.automationEnabled,
    manualOverrideMode: input.manualOverrideMode,
    autoOffSeconds: input.autoOffSeconds,
    retriggerMode: input.retriggerMode,
    debounceSeconds: input.debounceSeconds,
    cooldownSeconds: input.cooldownSeconds,
    testModeEnabled: input.testModeEnabled,
    scheduleMode: input.scheduleMode,
    scheduleJson: input.scheduleJson,
    clearSharedSecret: input.clearSharedSecret === true ? true : undefined,
    clearShellyPassword: input.clearShellyPassword === true ? true : undefined,
  };

  const { data } = await api.patch<Floodlight>(`/api/floodlights/${id}`, payload);
  return data;
}

export async function deleteFloodlight(id: number): Promise<void> {
  await api.delete(`/api/floodlights/${id}`);
}

export async function turnFloodlightOn(id: number): Promise<void> {
  await api.post(`/api/floodlights/${id}/on`);
}

export async function turnFloodlightOff(id: number): Promise<void> {
  await api.post(`/api/floodlights/${id}/off`);
}

export async function testFloodlightConnectivity(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data } = await api.post<{ ok: boolean; error?: string }>(`/api/floodlights/${id}/test`);
  return data;
}

export async function standardizeFloodlightConfig(id: number): Promise<{ ok: boolean }> {
  const { data } = await api.post<{ ok: boolean }>(`/api/floodlights/${id}/standardize`);
  return data;
}
