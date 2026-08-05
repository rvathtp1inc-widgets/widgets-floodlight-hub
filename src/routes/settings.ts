import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { hubSettings } from '../db/schema.js';
import { decryptString, encryptString } from '../lib/secrets.js';

type HubSettingsInsert = typeof hubSettings.$inferInsert;
type HubSettingsPatch = Partial<Omit<HubSettingsInsert, 'id' | 'createdAt' | 'updatedAt' | 'protectApiKeyEncrypted'>> & {
  protectApiKey?: unknown;
};

async function ensureSettingsRow() {
  const existing = await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) });
  if (existing) return existing;
  const created = await db
    .insert(hubSettings)
    .values({ id: 1, timezone: 'UTC', astroEnabled: false, defaultWebhookHeaderName: 'X-Widgets-Secret' })
    .returning();
  return created[0];
}

function toPublicSettings(row: typeof hubSettings.$inferSelect) {
  const { protectApiKeyEncrypted, ...publicRow } = row;
  return {
    ...publicRow,
    hasProtectApiKey: !!decryptString(protectApiKeyEncrypted)
  };
}

function normalizeStringOrNull(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => toPublicSettings(await ensureSettingsRow()));

  app.patch('/api/settings', async (request, reply) => {
    const body = request.body as HubSettingsPatch;
    const existing = await ensureSettingsRow();
    const updates: Partial<HubSettingsInsert> = { ...body };
    delete (updates as Record<string, unknown>).protectApiKey;

    try {
      if (body.protectApiKey !== undefined) {
        const protectApiKey = normalizeStringOrNull(body.protectApiKey, 'protectApiKey');
        if (protectApiKey) {
          updates.protectApiKeyEncrypted = encryptString(protectApiKey);
        }
      }

      if (body.protectConsoleHost !== undefined) {
        updates.protectConsoleHost = normalizeStringOrNull(body.protectConsoleHost, 'protectConsoleHost');
      }
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_settings', details: (error as Error).message });
    }

    const updated = await db
      .update(hubSettings)
      .set({ ...updates, updatedAt: DateTime.utc().toISO()! })
      .where(eq(hubSettings.id, existing.id))
      .returning();
    return toPublicSettings(updated[0]);
  });
}
