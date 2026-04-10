import axios from 'axios';

export type Floodlight = {
  id: string;
  name: string;
  onlineStatus: boolean;
  lastKnownOutput: boolean;
  automationEnabled: boolean;
  manualOverrideMode: boolean;
  testModeEnabled: boolean;
  testModeUntil: string | null;
  overrideUntil: string | null;
  autoOffSeconds: number | null;
  lastSeenAt: string | null;
  lastCommandStatus: string | null;
};

const api = axios.create({
  baseURL: 'http://localhost:3000',
});

export async function fetchFloodlights(): Promise<Floodlight[]> {
  const { data } = await api.get<Floodlight[]>('/api/floodlights');
  return data;
}

export async function turnFloodlightOn(id: string): Promise<void> {
  await api.post(`/api/floodlights/${id}/on`);
}

export async function turnFloodlightOff(id: string): Promise<void> {
  await api.post(`/api/floodlights/${id}/off`);
}
