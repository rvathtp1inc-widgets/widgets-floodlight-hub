import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { hubSettings } from '../db/schema.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const settings = await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) });
    return settings ?? null;
  });

  app.patch('/api/settings', async (request) => {
    const body = request.body as Record<string, unknown>;
    const existing = await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) });
    if (!existing) {
      const created = await db.insert(hubSettings).values({ id: 1, ...(body as never) }).returning();
      return created[0];
    }
    const updated = await db.update(hubSettings).set({ ...(body as never), updatedAt: DateTime.utc().toISO()! }).where(eq(hubSettings.id, 1)).returning();
    return updated[0];
  });
}
