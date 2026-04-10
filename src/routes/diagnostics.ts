import { count } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { activeTimers, commandLogs, eventLogs, floodlights, groups } from '../db/schema.js';
import { TimerService } from '../services/timers/timerService.js';

export async function diagnosticsRoutes(app: FastifyInstance, timerService: TimerService) {
  app.get('/api/events', async () => db.select().from(eventLogs).orderBy(eventLogs.id).limit(200));
  app.get('/api/commands', async () => db.select().from(commandLogs).orderBy(commandLogs.id).limit(200));
  app.get('/api/timers', async () => db.select().from(activeTimers).orderBy(activeTimers.id));

  app.get('/api/health', async () => {
    const floodlightCount = await db.select({ total: count() }).from(floodlights);
    const groupCount = await db.select({ total: count() }).from(groups);
    return {
      app: 'up',
      db: 'ok',
      timerService: timerService.isRunning() ? 'running' : 'stopped',
      counts: {
        floodlights: floodlightCount[0].total,
        groups: groupCount[0].total
      }
    };
  });
}
