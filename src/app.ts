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
import { protectSourceRoutes } from './routes/protectSources.js';
import { eventRouteRoutes } from './routes/eventRoutes.js';
import { CloudSyncService } from './services/cloud/cloudSyncService.js';
import { ProtectApiIngestService } from './services/protectApi/protectApiIngestService.js';
import { ProtectSourceSyncService } from './services/protectApi/protectSourceSyncService.js';
import { TimerService } from './services/timers/timerService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dist/app.js -> ../apps/frontend/dist
const frontendDistPath = path.resolve(__dirname, '../apps/frontend/dist');

export function buildApp() {
  const app = Fastify({ logger: true });
  const timerService = new TimerService();
  const cloudSyncService = new CloudSyncService(config.cloud, config.device, app.log);
  const protectApiIngestService = new ProtectApiIngestService(config.protectApi, app.log);
  const protectSourceSyncService = new ProtectSourceSyncService(config.protectApi, app.log);

  for (const warning of config.configWarnings) {
    app.log.warn(warning);
  }

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
    await diagnosticsRoutes(instance, timerService, cloudSyncService);
    await protectSourceRoutes(instance, protectSourceSyncService);
    await eventRouteRoutes(instance);
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
    cloudSyncService.start();
    protectApiIngestService.start();
  });

  app.addHook('onClose', async () => {
    timerService.stop();
    cloudSyncService.stop();
    protectApiIngestService.stop();
  });

  return app;
}
