import axios from 'axios';

const api = axios.create({ baseURL: '' });

export type HealthResponse = {
  app?: string;
  db?: string;
  timerService?: string;
  counts?: {
    floodlights?: number;
    groups?: number;
  };
};

export type EventLogItem = {
  id: number;
  receivedAt?: string;
  webhookKey?: string;
  targetType?: string | null;
  targetId?: number | null;
  httpMethod?: string;
  remoteIp?: string | null;
  headerSummary?: string | null;
  payloadRaw?: string | null;
  authResult?: string;
  decision?: string;
  decisionReason?: string | null;
  createdAt?: string;
};

export type CommandLogItem = {
  id: number;
  createdAt?: string;
  floodlightId?: number;
  commandType?: string;
  requestSummary?: string | null;
  responseSummary?: string | null;
  success?: boolean;
  errorText?: string | null;
};

export type ActiveTimerItem = {
  id: number;
  targetType?: string;
  targetId?: number;
  startedAt?: string;
  expiresAt?: string;
  sourceEventId?: number | null;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/api/health');
  return data;
}

export async function fetchEvents(): Promise<EventLogItem[]> {
  const { data } = await api.get<EventLogItem[]>('/api/events');
  return data;
}

export async function fetchCommands(): Promise<CommandLogItem[]> {
  const { data } = await api.get<CommandLogItem[]>('/api/commands');
  return data;
}

export async function fetchTimers(): Promise<ActiveTimerItem[]> {
  const { data } = await api.get<ActiveTimerItem[]>('/api/timers');
  return data;
}
