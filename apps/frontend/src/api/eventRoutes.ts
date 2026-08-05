import axios from 'axios';
import type { Floodlight } from './floodlights';
import type { Group } from './groups';

const api = axios.create({ baseURL: '' });

export type BindingStatus = 'resolved' | 'unresolved';
export type EventClass = 'motion' | 'zone' | 'line' | 'audio' | 'loiter';
export type TargetType = 'floodlight' | 'group';

export type ProtectSource = {
  id: number;
  protectCameraId: string;
  name: string;
  modelKey: string;
  state: string;
  supportsSmartDetect: boolean;
  supportedObjectTypes: string[];
  enabledObjectTypes: string[];
  lastSeenAt: string;
  lastEventSeenAt: string | null;
};

export type EventRoute = {
  id: number;
  sourceType: 'protect_source';
  sourceId: number;
  eventClass: EventClass;
  upstreamEventType: string | null;
  objectTypes: string[] | null;
  bindingStatus: BindingStatus;
  targetType: TargetType | null;
  targetId: number | null;
  enabled: boolean;
  isExecutable: boolean;
  notes: string | null;
};

export type EventRouteInput = {
  sourceType: 'protect_source';
  sourceId: number;
  eventClass: EventClass;
  upstreamEventType: string | null;
  objectTypes: string[] | null;
  bindingStatus: BindingStatus;
  targetType: TargetType | null;
  targetId: number | null;
  enabled: boolean;
  notes?: string | null;
};

export type RouteFloodlightTarget = Pick<Floodlight, 'id' | 'name' | 'webhookKey' | 'automationEnabled'>;
export type RouteGroupTarget = Pick<Group, 'id' | 'name' | 'webhookKey' | 'automationEnabled'>;

export async function fetchEventRoutes(): Promise<EventRoute[]> {
  const { data } = await api.get<EventRoute[]>('/api/routes');
  return data;
}

export async function createEventRoute(input: EventRouteInput): Promise<EventRoute> {
  const { data } = await api.post<EventRoute>('/api/routes', input);
  return data;
}

export async function updateEventRoute(id: number, input: EventRouteInput): Promise<EventRoute> {
  const { data } = await api.patch<EventRoute>(`/api/routes/${id}`, input);
  return data;
}

export async function deleteEventRoute(id: number): Promise<void> {
  await api.delete(`/api/routes/${id}`);
}

export async function fetchProtectSources(): Promise<ProtectSource[]> {
  const { data } = await api.get<ProtectSource[]>('/api/protect/sources');
  return data;
}

export async function fetchRouteFloodlightTargets(): Promise<RouteFloodlightTarget[]> {
  const { data } = await api.get<RouteFloodlightTarget[]>('/api/floodlights');
  return data;
}

export async function fetchRouteGroupTargets(): Promise<RouteGroupTarget[]> {
  const { data } = await api.get<RouteGroupTarget[]>('/api/groups');
  return data;
}
