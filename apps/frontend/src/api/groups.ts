import axios from 'axios';
import type { Floodlight, ScheduleJson, ScheduleMode } from './floodlights';

export type Group = {
  id: number;
  name: string;
  webhookKey: string;
  automationEnabled: boolean;
  testModeEnabled: boolean;
  testModeUntil: string | null;
  scheduleMode: ScheduleMode;
  scheduleJson: string | ScheduleJson;
  autoOffSeconds: number;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  notes: string | null;
  hasSharedSecret: boolean;
  memberFloodlightIds?: number[];
};

export type GroupUpsertInput = {
  name: string;
  webhookKey: string;
  sharedSecret?: string;
  automationEnabled: boolean;
  testModeEnabled: boolean;
  autoOffSeconds: number;
  retriggerMode: string;
  debounceSeconds: number;
  cooldownSeconds: number;
  scheduleMode: ScheduleMode;
  scheduleJson: ScheduleJson;
  notes?: string;
  memberFloodlightIds: number[];
  clearSharedSecret?: boolean;
};

export type TriggerTestResponse = {
  webhookUrl: string;
  headerName: string;
};

const api = axios.create({ baseURL: '' });

export async function fetchGroups(): Promise<Group[]> {
  const { data } = await api.get<Group[]>('/api/groups');
  return data;
}

export async function fetchGroup(id: number): Promise<Group> {
  const { data } = await api.get<Group>(`/api/groups/${id}`);
  return data;
}

export async function createGroup(input: GroupUpsertInput): Promise<Group> {
  const payload = {
    ...input,
    sharedSecret: input.sharedSecret?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
  };
  const { data } = await api.post<Group>('/api/groups', payload);
  return data;
}

export async function updateGroup(id: number, input: GroupUpsertInput): Promise<Group> {
  const payload = {
    ...input,
    sharedSecret: input.sharedSecret?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    clearSharedSecret: input.clearSharedSecret === true ? true : undefined,
  };

  const { data } = await api.patch<Group>(`/api/groups/${id}`, payload);
  return data;
}

export async function deleteGroup(id: number): Promise<void> {
  await api.delete(`/api/groups/${id}`);
}

export async function triggerGroupTest(id: number): Promise<TriggerTestResponse> {
  const { data } = await api.post<TriggerTestResponse>(`/api/groups/${id}/trigger-test`);
  return data;
}

export async function fetchGroupMembership(groupId: number): Promise<number[]> {
  const group = await fetchGroup(groupId);
  return group.memberFloodlightIds ?? [];
}

export type FloodlightSummary = Pick<Floodlight, 'id' | 'name' | 'webhookKey' | 'onlineStatus' | 'automationEnabled'>;

export async function fetchFloodlightSummaries(): Promise<FloodlightSummary[]> {
  const { data } = await api.get<FloodlightSummary[]>('/api/floodlights');
  return data;
}
