import { FastifyInstance } from 'fastify';
import { handleGroupWebhook } from '../services/webhooks/webhookService.js';
import { TimerService } from '../services/timers/timerService.js';

export async function webhookRoutes(app: FastifyInstance, timerService: TimerService) {
  app.get('/api/webhooks/unifi/:webhookKey', async (request) => {
    const params = request.params as { webhookKey: string };
    return handleGroupWebhook({
      webhookKey: params.webhookKey,
      method: 'GET',
      remoteIp: request.ip,
      headers: request.headers as Record<string, unknown>,
      timerService
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
      timerService
    });
  });
}
