import { FastifyInstance } from 'fastify';
import { handleGroupWebhook } from '../services/webhooks/webhookService.js';
import { IngressEventDispatcher } from '../services/ingress/ingressEventDispatcher.js';
import { ProtectSourceSyncService } from '../services/protectApi/protectSourceSyncService.js';

export async function webhookRoutes(
  app: FastifyInstance,
  ingressEventDispatcher: IngressEventDispatcher,
  protectSourceSyncService: ProtectSourceSyncService
) {
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
