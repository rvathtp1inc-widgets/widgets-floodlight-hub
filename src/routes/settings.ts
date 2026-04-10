import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { hubSettings } from '../db/schema.js';

type HubSettingsInsert = typeof hubSettings.$inferInsert;
type HubSettingsPatch = Partial<Omit<HubSettingsInsert, 'id' | 'createdAt' | 'updatedAt'>>;

async function ensureSettingsRow() {
  const existing = await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) });
  if (existing) return existing;
  const created = await db
    .insert(hubSettings)
    .values({ id: 1, timezone: 'UTC', astroEnabled: false, defaultWebhookHeaderName: 'X-Widgets-Secret' })
    .returning();
  return created[0];
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => ensureSettingsRow());

  app.patch('/api/settings', async (request) => {
    const body = request.body as HubSettingsPatch;
    const existing = await ensureSettingsRow();
    const updated = await db
      .update(hubSettings)
      .set({ ...body, updatedAt: DateTime.utc().toISO()! })
      .where(eq(hubSettings.id, existing.id))
      .returning();
    return updated[0];
  });
}
