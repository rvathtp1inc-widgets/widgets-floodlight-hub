import { count, desc, eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { activeTimers, commandLogs, eventLogs, floodlights, groups } from '../db/schema.js';
import { TimerService } from '../services/timers/timerService.js';

export async function diagnosticsRoutes(app: FastifyInstance, timerService: TimerService) {
  app.get('/api/events', async () => {
    const [events, floodlightRows, groupRows] = await Promise.all([
      db.select().from(eventLogs).orderBy(desc(eventLogs.id)).limit(200),
      db.select({ id: floodlights.id, name: floodlights.name }).from(floodlights),
      db.select({ id: groups.id, name: groups.name }).from(groups)
    ]);

    const floodlightNameById = new Map(floodlightRows.map((row) => [row.id, row.name]));
    const groupNameById = new Map(groupRows.map((row) => [row.id, row.name]));

    return events.map((event) => {
      const targetName = event.targetType === 'floodlight'
        ? floodlightNameById.get(event.targetId ?? -1) ?? null
        : event.targetType === 'group'
          ? groupNameById.get(event.targetId ?? -1) ?? null
          : null;

      return {
        ...event,
        targetName
      };
    });
  });

  app.get('/api/commands', async () => {
    const commands = await db
      .select({
        id: commandLogs.id,
        createdAt: commandLogs.createdAt,
        floodlightId: commandLogs.floodlightId,
        floodlightName: floodlights.name,
        commandType: commandLogs.commandType,
        requestSummary: commandLogs.requestSummary,
        responseSummary: commandLogs.responseSummary,
        success: commandLogs.success,
        errorText: commandLogs.errorText
      })
      .from(commandLogs)
      .leftJoin(floodlights, eq(commandLogs.floodlightId, floodlights.id))
      .orderBy(desc(commandLogs.id))
      .limit(200);

    return commands;
  });
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
