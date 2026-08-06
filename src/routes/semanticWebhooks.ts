import { eq } from 'drizzle-orm';
import { FastifyInstance, FastifyReply } from 'fastify';
import { DateTime } from 'luxon';
import { db, rawDb } from '../db/client.js';
import { hubSettings, semanticConditions, semanticConditionWebhooks } from '../db/schema.js';
import { encryptString } from '../lib/secrets.js';
import { SemanticWebhookTimerManager } from '../services/webhooks/semanticWebhookTimerManager.js';

const WEBHOOK_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function constraint(error: unknown): boolean {
  return (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') === true;
}

const INGRESS_CONFLICT_MESSAGE = 'This Condition is already controlled by another Automation or Semantic Webhook.';

function ingressConflict(reply: FastifyReply) {
  return reply.code(409).send({
    error: 'semantic_condition_ingress_conflict',
    code: 'semantic_condition_ingress_conflict',
    message: INGRESS_CONFLICT_MESSAGE
  });
}

function hasConflictingRoute(semanticConditionId: number) {
  return Boolean(rawDb.prepare(`SELECT 1 FROM event_routes
    WHERE target_type = 'semantic_condition' AND target_id = ?
      AND enabled = 1 AND binding_status = 'resolved' LIMIT 1`).get(semanticConditionId));
}

function validateRestoreConfiguration(restoreMode: unknown, autoRestoreSeconds: unknown) {
  if (restoreMode !== 'explicit_inactive' && restoreMode !== 'auto_timeout') return 'invalid_restore_mode';
  if (restoreMode === 'explicit_inactive') {
    if (autoRestoreSeconds !== null && autoRestoreSeconds !== undefined && (!Number.isInteger(autoRestoreSeconds) || Number(autoRestoreSeconds) < 1 || Number(autoRestoreSeconds) > 86_400)) return 'invalid_auto_restore_seconds';
    return null;
  }
  if (autoRestoreSeconds === null || autoRestoreSeconds === undefined) return 'auto_restore_seconds_required';
  if (!Number.isInteger(autoRestoreSeconds) || Number(autoRestoreSeconds) < 1 || Number(autoRestoreSeconds) > 86_400) return 'invalid_auto_restore_seconds';
  return null;
}

async function authenticationHeaderName() {
  return (await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) }))?.defaultWebhookHeaderName ?? 'X-Widgets-Secret';
}

async function toPublic(row: typeof semanticConditionWebhooks.$inferSelect, conditionLabel: string) {
  const headerName = await authenticationHeaderName();
  return {
    id: row.id,
    semanticConditionId: row.semanticConditionId,
    semanticConditionLabel: conditionLabel,
    displayName: row.displayName,
    webhookKey: row.webhookKey,
    enabled: row.enabled,
    restoreMode: row.restoreMode,
    autoRestoreSeconds: row.autoRestoreSeconds,
    hasSharedSecret: Boolean(row.encryptedSharedSecret),
    configured: Boolean(row.encryptedSharedSecret),
    activePath: `/api/webhooks/semantic/${encodeURIComponent(row.webhookKey)}/active`,
    inactivePath: `/api/webhooks/semantic/${encodeURIComponent(row.webhookKey)}/inactive`,
    authenticationHeaderName: headerName,
    authenticationHeaderDescription: `Send the shared secret in the ${headerName} header.`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function loadPublic(id: number) {
  const row = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.id, id) });
  if (!row) return null;
  const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, row.semanticConditionId) });
  return condition ? toPublic(row, condition.label) : null;
}

export async function semanticWebhookRoutes(app: FastifyInstance, timerManager: SemanticWebhookTimerManager) {
  app.get('/api/semantic-webhooks', async () => {
    const rows = await db.select().from(semanticConditionWebhooks);
    return Promise.all(rows.map(async (row) => {
      const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, row.semanticConditionId) });
      return toPublic(row, condition?.label ?? 'Missing semantic condition');
    }));
  });

  app.get('/api/semantic-webhooks/:id', async (request, reply) => {
    const row = await loadPublic(Number((request.params as { id: string }).id));
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/semantic-webhooks', async (request, reply) => {
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const semanticConditionId = request.body.semanticConditionId;
    const webhookKey = typeof request.body.webhookKey === 'string' ? request.body.webhookKey.trim() : '';
    const enabled = request.body.enabled ?? true;
    const restoreMode = request.body.restoreMode ?? 'explicit_inactive';
    const autoRestoreSeconds = request.body.autoRestoreSeconds ?? null;
    if (!Number.isInteger(semanticConditionId) || Number(semanticConditionId) <= 0 || !WEBHOOK_KEY_PATTERN.test(webhookKey) || typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_semantic_webhook' });
    }
    const restoreError = validateRestoreConfiguration(restoreMode, autoRestoreSeconds);
    if (restoreError) return reply.code(400).send({ error: restoreError, code: restoreError });
    const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, Number(semanticConditionId)) });
    if (!condition) return reply.code(400).send({ error: 'semantic_condition_not_found' });
    if (enabled && hasConflictingRoute(condition.id)) return ingressConflict(reply);
    let displayName = condition.label;
    if ('displayName' in request.body) {
      if (typeof request.body.displayName !== 'string' || !request.body.displayName.trim()) return reply.code(400).send({ error: 'invalid_semantic_webhook' });
      displayName = request.body.displayName.trim();
    }
    if ('sharedSecret' in request.body && typeof request.body.sharedSecret !== 'string') return reply.code(400).send({ error: 'invalid_semantic_webhook' });
    const sharedSecret = typeof request.body.sharedSecret === 'string' ? request.body.sharedSecret : '';
    const conditionDuplicate = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.semanticConditionId, condition.id) });
    if (conditionDuplicate) return reply.code(409).send({ error: 'semantic_condition_webhook_conflict' });
    const keyDuplicate = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.webhookKey, webhookKey) });
    if (keyDuplicate) return reply.code(409).send({ error: 'webhook_key_conflict' });
    try {
      const inserted = await db.insert(semanticConditionWebhooks).values({
        semanticConditionId: condition.id, displayName, webhookKey,
        encryptedSharedSecret: sharedSecret.trim() ? encryptString(sharedSecret) : null, enabled,
        restoreMode: restoreMode as string, autoRestoreSeconds: autoRestoreSeconds as number | null
      }).returning();
      return reply.code(201).send(await toPublic(inserted[0], condition.label));
    } catch (error) {
      if (constraint(error)) return reply.code(409).send({ error: 'semantic_webhook_conflict' });
      throw error;
    }
  });

  app.patch('/api/semantic-webhooks/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const existing = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if ('semanticConditionId' in request.body) return reply.code(400).send({ error: 'semantic_condition_id_immutable' });
    if ('webhookKey' in request.body) return reply.code(400).send({ error: 'webhook_key_immutable' });
    const updates: Partial<typeof semanticConditionWebhooks.$inferInsert> = { updatedAt: DateTime.utc().toISO()! };
    if ('displayName' in request.body) {
      if (typeof request.body.displayName !== 'string' || !request.body.displayName.trim()) return reply.code(400).send({ error: 'invalid_semantic_webhook' });
      updates.displayName = request.body.displayName.trim();
    }
    if ('enabled' in request.body) {
      if (typeof request.body.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_semantic_webhook' });
      updates.enabled = request.body.enabled;
      if (request.body.enabled && !existing.enabled && hasConflictingRoute(existing.semanticConditionId)) return ingressConflict(reply);
    }
    const nextRestoreMode = request.body.restoreMode ?? existing.restoreMode;
    const nextAutoRestoreSeconds = 'autoRestoreSeconds' in request.body ? request.body.autoRestoreSeconds : existing.autoRestoreSeconds;
    const restoreError = validateRestoreConfiguration(nextRestoreMode, nextAutoRestoreSeconds);
    if (restoreError) return reply.code(400).send({ error: restoreError, code: restoreError });
    if ('restoreMode' in request.body) updates.restoreMode = nextRestoreMode as string;
    if ('autoRestoreSeconds' in request.body) updates.autoRestoreSeconds = nextAutoRestoreSeconds as number | null;
    if ('sharedSecret' in request.body && typeof request.body.sharedSecret !== 'string') return reply.code(400).send({ error: 'invalid_semantic_webhook' });
    if (request.body.clearSharedSecret === true) {
      updates.encryptedSharedSecret = null;
    } else if (typeof request.body.sharedSecret === 'string' && request.body.sharedSecret.trim()) {
      updates.encryptedSharedSecret = encryptString(request.body.sharedSecret);
    }
    const updated = await db.update(semanticConditionWebhooks).set(updates).where(eq(semanticConditionWebhooks.id, id)).returning();
    if ((updates.enabled === false && existing.enabled) || (existing.restoreMode === 'auto_timeout' && nextRestoreMode !== 'auto_timeout')) {
      timerManager.cancel(existing.id);
    }
    const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, existing.semanticConditionId) });
    return toPublic(updated[0], condition?.label ?? 'Missing semantic condition');
  });

  app.delete('/api/semantic-webhooks/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = await db.query.semanticConditionWebhooks.findFirst({ where: eq(semanticConditionWebhooks.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    timerManager.cancel(existing.id);
    await db.delete(semanticConditionWebhooks).where(eq(semanticConditionWebhooks.id, id));
    return { ok: true };
  });
}
