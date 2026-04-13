import { sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { commandLogs, eventLogs } from '../../db/schema.js';

const EVENT_LOG_RETENTION_LIMIT = 10_000;
const COMMAND_LOG_RETENTION_LIMIT = 10_000;

type EventLogInsert = typeof eventLogs.$inferInsert;
type CommandLogInsert = typeof commandLogs.$inferInsert;

export async function insertEventLogWithRetention(values: EventLogInsert) {
  const inserted = await db.insert(eventLogs).values(values).returning({ id: eventLogs.id });
  await db.run(sql`
    delete from event_logs
    where id in (
      select id
      from event_logs
      order by id desc
      limit -1 offset ${EVENT_LOG_RETENTION_LIMIT}
    )
  `);
  return inserted;
}

export async function insertCommandLogWithRetention(values: CommandLogInsert) {
  await db.insert(commandLogs).values(values);
  await db.run(sql`
    delete from command_logs
    where id in (
      select id
      from command_logs
      order by id desc
      limit -1 offset ${COMMAND_LOG_RETENTION_LIMIT}
    )
  `);
}

