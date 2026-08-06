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
  targetName?: string | null;
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
  floodlightName?: string | null;
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

export type ExecutionDiagnosticItem = {
  id: number; createdAt: string; diagnosticType: 'semantic_action' | 'consumer_binding' | 'semantic_aggregate';
  sequence: number; traceId: string; ingressType: string; source: string; sourceEventType: string | null;
  sourceEventClass: string; routeId: number | null; semanticWebhookId: number | null; webhookKey: string | null;
  semanticConditionId: number; semanticConditionKey: string | null; semanticConditionLabel: string | null;
  requestedState: 'active' | 'inactive'; lifecycleIntent: 'trigger' | 'restore'; consumerBindingId: number | null;
  stateOrigin: 'explicit_active' | 'explicit_inactive' | 'auto_timeout' | null; timerExpired: boolean | null; autoRestoreSeconds: number | null;
  consumerType: string | null; destinationSummary: Record<string, unknown> | null; accepted: boolean;
  changed: boolean | null; delivered: boolean | null; retained: boolean | null; reason: string;
  bindingCount: number | null; successfulBindingCount: number | null; failedBindingCount: number | null;
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

export async function fetchExecutionDiagnostics(): Promise<ExecutionDiagnosticItem[]> {
  const { data } = await api.get<ExecutionDiagnosticItem[]>('/api/execution-diagnostics');
  return data;
}
