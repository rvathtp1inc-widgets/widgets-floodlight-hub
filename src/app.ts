import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { rawDb } from './db/client.js';
import { floodlightRoutes } from './routes/floodlights.js';
import { groupRoutes } from './routes/groups.js';
import { webhookRoutes } from './routes/webhooks.js';
import { settingsRoutes } from './routes/settings.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { TimerService } from './services/timers/timerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dist/app.js -> ../apps/frontend/dist
const frontendDistPath = path.resolve(__dirname, '../apps/frontend/dist');

export function buildApp() {
  const app = Fastify({ logger: true });
  const timerService = new TimerService();

  app.register(fastifyStatic, {
    root: frontendDistPath,
    prefix: '/',
    decorateReply: false,
  });

  app.register(async (instance) => {
    await floodlightRoutes(instance);
    await groupRoutes(instance);
    await webhookRoutes(instance, timerService);
    await settingsRoutes(instance);
    await diagnosticsRoutes(instance, timerService);
  });

  // Optional API root; move it off "/" so frontend can own "/"
  app.get('/api', async () => ({ name: 'Widgets Floodlight Hub API', status: 'ok' }));

  // SPA fallback for non-API routes
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.raw.url ?? '/';

    if (url.startsWith('/api/')) {
      reply.code(404);
      return { error: 'Not Found' };
    }

    return reply.sendFile('index.html');
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
