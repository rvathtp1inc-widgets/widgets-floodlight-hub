import Fastify from 'fastify';
import { config } from './config.js';
import { rawDb } from './db/client.js';
import { floodlightRoutes } from './routes/floodlights.js';
import { groupRoutes } from './routes/groups.js';
import { webhookRoutes } from './routes/webhooks.js';
import { settingsRoutes } from './routes/settings.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { TimerService } from './services/timers/timerService.js';

export function buildApp() {
  const app = Fastify({ logger: true });
  const timerService = new TimerService();

  app.get('/', async () => ({ name: 'Widgets Floodlight Hub API', status: 'ok' }));

  app.register(async (instance) => {
    await floodlightRoutes(instance);
    await groupRoutes(instance);
    await webhookRoutes(instance, timerService);
    await settingsRoutes(instance);
    await diagnosticsRoutes(instance, timerService);
  });

  app.addHook('onReady', async () => {
    rawDb.prepare('SELECT 1').get();
    timerService.start(config.timerPollSeconds);
  });

  app.addHook('onClose', async () => {
    timerService.stop();
  });

  return app;
}
