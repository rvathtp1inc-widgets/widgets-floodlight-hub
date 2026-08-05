import { FastifyInstance } from 'fastify';
import { AccessIngestService } from '../services/accessApi/accessIngestService.js';

function classifyAccessError(error: unknown) {
  const message = (error as Error).message;
  const lower = message.toLowerCase();
  const status = lower.includes('disabled') || lower.includes('configured') ? 400 : 502;
  return {
    status,
    message
  };
}

export async function accessRoutes(app: FastifyInstance, accessIngestService: AccessIngestService) {
  app.get('/api/access/users', async () => accessIngestService.listUsers());

  app.post('/api/access/users/sync', async (_request, reply) => {
    try {
      return await accessIngestService.syncUsers();
    } catch (error) {
      const accessError = classifyAccessError(error);
      return reply.code(accessError.status).send({
        error: 'access_users_sync_failed',
        details: accessError.message
      });
    }
  });

  app.get('/api/access/doors', async () => accessIngestService.listDoors());

  app.post('/api/access/doors/sync', async (_request, reply) => {
    try {
      return await accessIngestService.syncDoors();
    } catch (error) {
      const accessError = classifyAccessError(error);
      return reply.code(accessError.status).send({
        error: 'access_doors_sync_failed',
        details: accessError.message
      });
    }
  });

  app.post('/api/access/logs/poll', async (_request, reply) => {
    try {
      return await accessIngestService.pollLogs();
    } catch (error) {
      const accessError = classifyAccessError(error);
      return reply.code(accessError.status).send({
        error: 'access_logs_poll_failed',
        details: accessError.message
      });
    }
  });

  app.get('/api/access/ingest-state', async () => accessIngestService.getIngestState());

  app.post('/api/access/poll/start', async (_request, reply) => {
    try {
      return accessIngestService.startBackgroundPolling();
    } catch (error) {
      const accessError = classifyAccessError(error);
      return reply.code(accessError.status).send({
        error: 'access_poll_start_failed',
        details: accessError.message
      });
    }
  });

  app.post('/api/access/poll/stop', async () => accessIngestService.stopBackgroundPolling());

  app.get('/api/access/poll/status', async () => accessIngestService.getPollStatus());
}
