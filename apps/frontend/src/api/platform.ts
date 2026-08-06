import axios from 'axios';

const api = axios.create({ baseURL: '' });

export type SemanticCondition = {
  id: number; semanticKey: string; label: string; enabled: boolean;
  restorePolicy: 'source_lifecycle'; createdAt: string; updatedAt: string;
};
export type ConsumerBinding = {
  id: number; semanticConditionId: number; consumerType: 'virtual_security_panel';
  binding: { panelKey: 'default'; zoneNumber: number }; enabled: boolean;
  createdAt: string; updatedAt: string;
};
export type CloudStatus = {
  enabled: boolean; identityConfigured: boolean; configuredApiBaseUrl: string;
  heartbeatIntervalSeconds: number;
  bootstrap: { state: string; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null };
  heartbeat: { state: string; lastAttemptAt: string | null; lastSuccessAt: string | null; lastError: string | null };
  runtimeIdentity: Record<string, unknown> | null;
};
export type AccessPollStatus = {
  enabled: boolean; configuredApiBaseUrl: string; pollIntervalMs: number;
  backgroundPollingConfigured: boolean; backgroundPollingRunning: boolean; pollInFlight: boolean;
  lastPollStartedAt: string | null; lastPollCompletedAt: string | null; lastPollError: string | null;
};
export type AccessDoor = { id: string; name: string | null; fullName: string | null; lastSeenAt: string };
export type SemanticWebhook = {
  id: number; semanticConditionId: number; semanticConditionLabel: string; displayName: string;
  webhookKey: string; enabled: boolean; hasSharedSecret: boolean; configured: boolean;
  restoreMode: 'explicit_inactive' | 'auto_timeout'; autoRestoreSeconds: number | null;
  activePath: string; inactivePath: string; authenticationHeaderName: string;
  authenticationHeaderDescription: string; createdAt: string; updatedAt: string;
};

export const fetchConditions = async () => (await api.get<SemanticCondition[]>('/api/semantic-conditions')).data;
export const createCondition = async (input: Pick<SemanticCondition, 'semanticKey' | 'label' | 'enabled' | 'restorePolicy'>) =>
  (await api.post<SemanticCondition>('/api/semantic-conditions', input)).data;
export const updateCondition = async (id: number, input: Partial<Pick<SemanticCondition, 'label' | 'enabled' | 'restorePolicy'>>) =>
  (await api.patch<SemanticCondition>(`/api/semantic-conditions/${id}`, input)).data;
export const deleteCondition = async (id: number) => { await api.delete(`/api/semantic-conditions/${id}`); };

export const fetchConsumerBindings = async () => (await api.get<ConsumerBinding[]>('/api/consumer-bindings')).data;
export const createConsumerBinding = async (input: { semanticConditionId: number; consumerType: 'virtual_security_panel'; binding: { panelKey: 'default'; zoneNumber: number }; enabled: boolean }) =>
  (await api.post<ConsumerBinding>('/api/consumer-bindings', input)).data;
export const updateConsumerBinding = async (id: number, input: { binding?: { panelKey: 'default'; zoneNumber: number }; enabled?: boolean }) =>
  (await api.patch<ConsumerBinding>(`/api/consumer-bindings/${id}`, input)).data;
export const deleteConsumerBinding = async (id: number) => { await api.delete(`/api/consumer-bindings/${id}`); };

export const fetchCloudStatus = async () => (await api.get<CloudStatus>('/api/cloud/status')).data;
export const fetchAccessPollStatus = async () => (await api.get<AccessPollStatus>('/api/access/poll/status')).data;
export const fetchAccessDoors = async () => (await api.get<AccessDoor[]>('/api/access/doors')).data;
export const fetchSemanticWebhooks = async () => (await api.get<SemanticWebhook[]>('/api/semantic-webhooks')).data;
export type SemanticWebhookCreateInput = { semanticConditionId: number; displayName?: string; webhookKey: string; sharedSecret?: string; enabled?: boolean; restoreMode: 'explicit_inactive' | 'auto_timeout'; autoRestoreSeconds: number | null };
export type SemanticWebhookUpdateInput = { displayName?: string; enabled?: boolean; sharedSecret?: string; clearSharedSecret?: boolean; restoreMode?: 'explicit_inactive' | 'auto_timeout'; autoRestoreSeconds?: number | null };
export const createSemanticWebhook = async (input: SemanticWebhookCreateInput) =>
  (await api.post<SemanticWebhook>('/api/semantic-webhooks', input)).data;
export const updateSemanticWebhook = async (id: number, input: SemanticWebhookUpdateInput) =>
  (await api.patch<SemanticWebhook>(`/api/semantic-webhooks/${id}`, input)).data;
export const deleteSemanticWebhook = async (id: number) => { await api.delete(`/api/semantic-webhooks/${id}`); };
