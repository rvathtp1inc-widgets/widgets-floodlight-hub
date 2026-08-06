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
import { accessRoutes } from './routes/access.js';
import { protectSourceRoutes } from './routes/protectSources.js';
import { eventRouteRoutes } from './routes/eventRoutes.js';
import { semanticConditionRoutes } from './routes/semanticConditions.js';
import { semanticWebhookRoutes } from './routes/semanticWebhooks.js';
import { consumerBindingRoutes } from './routes/consumerBindings.js';
import { registerExecutionPlannerSubscriber, registerSemanticActionPlannerSubscriber } from './services/execution/executionPlannerSubscriber.js';
import { FloodlightExecutor } from './services/execution/floodlightExecutor.js';
import { GroupExecutor } from './services/execution/groupExecutor.js';
import { registerLifecycleExecutionGate } from './services/execution/lifecycleExecutionGate.js';
import { AccessIngestService } from './services/accessApi/accessIngestService.js';
import { CloudSyncService } from './services/cloud/cloudSyncService.js';
import { registerIngressDiagnosticsSubscriber } from './services/ingress/ingressDiagnosticsSubscriber.js';
import { IngressEventDispatcher } from './services/ingress/ingressEventDispatcher.js';
import { registerRouteEvaluatorSubscriber } from './services/ingress/routeEvaluatorSubscriber.js';
import { ProtectApiIngestService } from './services/protectApi/protectApiIngestService.js';
import { ProtectSourceSyncService } from './services/protectApi/protectSourceSyncService.js';
import { TimerService } from './services/timers/timerService.js';
import { SavantVirtualSecurityPanelConsumer } from './services/virtualSecurityPanel/virtualSecurityPanelConsumer.js';
import { virtualSecurityPanelUnavailableResult, VirtualSecurityPanelAdapter } from './services/execution/virtualSecurityPanelAdapter.js';
import { executeSemanticConditionRoute } from './services/execution/semanticConditionExecutionService.js';
import { initializeVirtualSecurityPanelRuntime } from './services/execution/virtualSecurityPanelRuntime.js';
import { SemanticWebhookTimerManager } from './services/webhooks/semanticWebhookTimerManager.js';
import { handleSemanticWebhookTimerExpiry } from './services/webhooks/semanticWebhookAutoRestoreService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dist/app.js -> ../apps/frontend/dist
const frontendDistPath = path.resolve(__dirname, '../apps/frontend/dist');

export function buildApp() {
  const app = Fastify({ logger: true });
  const timerService = new TimerService();
  const cloudSyncService = new CloudSyncService(config.cloud, config.device, app.log);
  const ingressEventDispatcher = new IngressEventDispatcher();
  const semanticWebhookTimerManager = new SemanticWebhookTimerManager(async (semanticWebhookId) => {
    try {
      await handleSemanticWebhookTimerExpiry({ semanticWebhookId, logger: app.log, ingressEventDispatcher });
    } catch (error) {
      app.log.error({ semanticWebhookId, err: error }, 'Semantic webhook auto-restore timer callback failed.');
    }
  });
  const protectSourceSyncService = new ProtectSourceSyncService(app.log);
  const accessIngestService = new AccessIngestService(config.access, app.log, ingressEventDispatcher);
  const virtualSecurityPanelConsumer = new SavantVirtualSecurityPanelConsumer({
    host: config.virtualSecurityPanel.listenHost,
    port: config.virtualSecurityPanel.listenPort,
    logger: app.log
  });
  let virtualSecurityPanelAdapter: VirtualSecurityPanelAdapter | undefined;
  const semanticConditionHandler: typeof executeSemanticConditionRoute = (input) => executeSemanticConditionRoute({
    ...input,
    consumer: async (action) => virtualSecurityPanelAdapter
      ? virtualSecurityPanelAdapter(action)
      : virtualSecurityPanelUnavailableResult(action)
  });
  const routeExecutionHandler = registerExecutionPlannerSubscriber({
    logger: app.log,
    timerService,
    executors: [new FloodlightExecutor(), new GroupExecutor()],
    semanticConditionHandler
  });
  const lifecycleExecutionGate = registerLifecycleExecutionGate({
    logger: app.log,
    next: routeExecutionHandler
  });
  registerIngressDiagnosticsSubscriber(ingressEventDispatcher, app.log);
  registerSemanticActionPlannerSubscriber({ dispatcher: ingressEventDispatcher, logger: app.log, semanticConditionHandler });
  registerRouteEvaluatorSubscriber(ingressEventDispatcher, app.log, lifecycleExecutionGate);
  const protectApiIngestService = new ProtectApiIngestService(
    app.log,
    protectSourceSyncService,
    ingressEventDispatcher
  );

  for (const warning of config.configWarnings) {
    app.log.warn(warning);
  }

  app.register(fastifyStatic, {
    root: frontendDistPath,
    prefix: '/',
  });

  app.register(async (instance) => {
    await floodlightRoutes(instance);
    await groupRoutes(instance);
    await webhookRoutes(instance, ingressEventDispatcher, protectSourceSyncService, semanticWebhookTimerManager);
    await settingsRoutes(instance);
    await diagnosticsRoutes(instance, timerService, cloudSyncService);
    await accessRoutes(instance, accessIngestService);
    await protectSourceRoutes(instance, protectSourceSyncService);
    await eventRouteRoutes(instance);
    await semanticConditionRoutes(instance);
    await semanticWebhookRoutes(instance, semanticWebhookTimerManager);
    await consumerBindingRoutes(instance);
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
    if (config.virtualSecurityPanel.enabled) {
      const rows = rawDb.prepare(`SELECT binding_json FROM consumer_bindings
        WHERE enabled = 1 AND consumer_type = 'virtual_security_panel'
          AND json_extract(binding_json, '$.panelKey') = 'default'
        ORDER BY id ASC`).all() as Array<{ binding_json: string }>;
      const configuredZoneNumbers = rows.map((row) => {
        const binding = JSON.parse(row.binding_json) as { zoneNumber: number };
        return binding.zoneNumber;
      });
      let configuredZones: number[];
      try {
        configuredZones = await initializeVirtualSecurityPanelRuntime({
          consumer: virtualSecurityPanelConsumer,
          configuredZoneNumbers,
          registerAdapter: (adapter) => { virtualSecurityPanelAdapter = adapter; }
        });
      } catch (error) {
        app.log.error({
          service: 'virtualSecurityPanel',
          host: config.virtualSecurityPanel.listenHost,
          port: config.virtualSecurityPanel.listenPort,
          err: error
        }, 'Virtual Security Panel listener failed to start.');
        throw error;
      }
      app.log.info({
        service: 'virtualSecurityPanel',
        configuredZones
      }, 'Virtual Security Panel consumer seeded, listening, and registered.');
    }
    timerService.start(config.timerPollSeconds);
    cloudSyncService.start();
    accessIngestService.start();
    await protectApiIngestService.start();
  });

  app.addHook('onClose', async () => {
    timerService.stop();
    cloudSyncService.stop();
    accessIngestService.stop();
    protectApiIngestService.stop();
    semanticWebhookTimerManager.stopAll();
    if (config.virtualSecurityPanel.enabled) await virtualSecurityPanelConsumer.stop();
  });

  return app;
}
