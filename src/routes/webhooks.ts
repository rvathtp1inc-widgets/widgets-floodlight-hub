import { FastifyInstance } from 'fastify';
import { handleGroupWebhook } from '../services/webhooks/webhookService.js';
import { handleSemanticWebhook } from '../services/webhooks/semanticWebhookService.js';
import { SemanticWebhookTimerManager } from '../services/webhooks/semanticWebhookTimerManager.js';
import { IngressEventDispatcher } from '../services/ingress/ingressEventDispatcher.js';
import { ProtectSourceSyncService } from '../services/protectApi/protectSourceSyncService.js';

export async function webhookRoutes(
  app: FastifyInstance,
  ingressEventDispatcher: IngressEventDispatcher,
  protectSourceSyncService: ProtectSourceSyncService,
  semanticWebhookTimerManager: SemanticWebhookTimerManager
) {
  for (const requestedState of ['active', 'inactive'] as const) {
    app.post(`/api/webhooks/semantic/:webhookKey/${requestedState}`, async (request, reply) => {
      const result = await handleSemanticWebhook({
        webhookKey: (request.params as { webhookKey: string }).webhookKey,
        requestedState,
        method: 'POST',
        remoteIp: request.ip,
        headers: request.headers as Record<string, unknown>,
        logger: app.log,
        ingressEventDispatcher,
        timerManager: semanticWebhookTimerManager
      });
      return reply.code(result.status).send(result.body);
    });
  }

  app.get('/api/webhooks/unifi/:webhookKey', async (request) => {
    const params = request.params as { webhookKey: string };
    return handleGroupWebhook({
      webhookKey: params.webhookKey,
      method: 'GET',
      remoteIp: request.ip,
      headers: request.headers as Record<string, unknown>,
      logger: app.log,
      ingressEventDispatcher,
      protectSourceSyncService
    });
  });

  app.post('/api/webhooks/unifi/:webhookKey', async (request) => {
    const params = request.params as { webhookKey: string };
    return handleGroupWebhook({
      webhookKey: params.webhookKey,
      method: 'POST',
      remoteIp: request.ip,
      headers: request.headers as Record<string, unknown>,
      payload: request.body,
      logger: app.log,
      ingressEventDispatcher,
      protectSourceSyncService
    });
  });
}
