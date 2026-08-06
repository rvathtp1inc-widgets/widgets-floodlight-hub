import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';

export function normalizeSemanticWebhookEvent(input: {
  traceId: string;
  receivedAt: string;
  webhookKey: string;
  semanticWebhookId: number;
  semanticConditionId: number;
  semanticConditionLabel: string;
  requestedState: 'active' | 'inactive';
  ingressType?: 'webhook' | 'timer';
  stateOrigin?: 'explicit_active' | 'explicit_inactive' | 'auto_timeout';
  timerExpired?: boolean;
  autoRestoreSeconds?: number;
}): NormalizedIngressEvent<Record<string, never>> {
  const lifecycleIntent = input.requestedState === 'active' ? 'trigger' : 'restore';
  return {
    source: 'semantic_webhook',
    ingressType: input.ingressType ?? 'webhook',
    timestamp: input.receivedAt,
    eventId: input.traceId,
    eventType: `semantic.${input.requestedState}`,
    eventClass: 'semantic_state',
    cameraId: null,
    objectTypes: [],
    userId: null,
    userName: null,
    doorId: null,
    doorName: null,
    credentialProvider: null,
    result: null,
    raw: {},
    diagnosticsOnly: false,
    lifecycle: lifecycleIntent,
    precision: {
      webhookKey: input.webhookKey,
      semanticWebhookId: input.semanticWebhookId,
      semanticConditionId: input.semanticConditionId,
      semanticConditionLabel: input.semanticConditionLabel,
      requestedState: input.requestedState,
      lifecycleIntent,
      stateOrigin: input.stateOrigin ?? (input.requestedState === 'active' ? 'explicit_active' : 'explicit_inactive'),
      timerExpired: input.timerExpired ?? false,
      ...(input.autoRestoreSeconds === undefined ? {} : { autoRestoreSeconds: input.autoRestoreSeconds }),
      sharedSecretValidated: true
    }
  };
}
