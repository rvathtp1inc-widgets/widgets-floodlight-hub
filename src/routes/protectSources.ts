import { FastifyInstance } from 'fastify';
import { ProtectSourceSyncService } from '../services/protectApi/protectSourceSyncService.js';

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function toPublicProtectSource(row: Awaited<ReturnType<ProtectSourceSyncService['listSources']>>[number]) {
  return {
    ...row,
    supportedObjectTypes: parseStringArray(row.supportedObjectTypesJson),
    enabledObjectTypes: parseStringArray(row.enabledObjectTypesJson)
  };
}

export async function protectSourceRoutes(app: FastifyInstance, protectSourceSyncService: ProtectSourceSyncService) {
  app.get('/api/protect/sources', async () => {
    const rows = await protectSourceSyncService.listSources();
    return rows.map((row) => toPublicProtectSource(row));
  });

  app.post('/api/protect/sources/sync', async (_request, reply) => {
    try {
      return await protectSourceSyncService.syncSources();
    } catch (error) {
      const message = (error as Error).message;
      const status = message.includes('disabled') || message.includes('configured') ? 400 : 502;
      return reply.code(status).send({ error: 'protect_sync_failed', details: message });
    }
  });
}
