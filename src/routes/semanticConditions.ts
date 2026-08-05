import { eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db, rawDb } from '../db/client.js';
import { semanticConditions } from '../db/schema.js';

const SEMANTIC_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function conflict(error: unknown): boolean {
  return (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') === true;
}

export async function semanticConditionRoutes(app: FastifyInstance) {
  app.get('/api/semantic-conditions', async () => db.select().from(semanticConditions));

  app.get('/api/semantic-conditions/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, id) });
    return row ?? reply.code(404).send({ error: 'not_found' });
  });

  app.post('/api/semantic-conditions', async (request, reply) => {
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const semanticKey = typeof request.body.semanticKey === 'string' ? request.body.semanticKey.trim() : '';
    const label = typeof request.body.label === 'string' ? request.body.label.trim() : '';
    const enabled = request.body.enabled ?? true;
    const restorePolicy = request.body.restorePolicy ?? 'source_lifecycle';
    if (!SEMANTIC_KEY_PATTERN.test(semanticKey) || !label || typeof enabled !== 'boolean' || restorePolicy !== 'source_lifecycle') {
      return reply.code(400).send({ error: 'invalid_semantic_condition' });
    }
    try {
      const inserted = await db.insert(semanticConditions).values({ semanticKey, label, enabled, restorePolicy }).returning();
      return reply.code(201).send(inserted[0]);
    } catch (error) {
      if (conflict(error)) return reply.code(409).send({ error: 'semantic_key_conflict' });
      throw error;
    }
  });

  app.patch('/api/semantic-conditions/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const existing = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if ('semanticKey' in request.body) return reply.code(400).send({ error: 'semantic_key_immutable' });
    const updates: Partial<typeof semanticConditions.$inferInsert> = { updatedAt: DateTime.utc().toISO()! };
    if ('label' in request.body) {
      if (typeof request.body.label !== 'string' || !request.body.label.trim()) return reply.code(400).send({ error: 'invalid_semantic_condition' });
      updates.label = request.body.label.trim();
    }
    if ('enabled' in request.body) {
      if (typeof request.body.enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_semantic_condition' });
      updates.enabled = request.body.enabled;
    }
    if ('restorePolicy' in request.body) {
      if (request.body.restorePolicy !== 'source_lifecycle') return reply.code(400).send({ error: 'invalid_semantic_condition' });
      updates.restorePolicy = 'source_lifecycle';
    }
    const updated = await db.update(semanticConditions).set(updates).where(eq(semanticConditions.id, id)).returning();
    return updated[0];
  });

  app.delete('/api/semantic-conditions/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const routeReference = rawDb.prepare("SELECT 1 FROM event_routes WHERE target_type = 'semantic_condition' AND target_id = ? LIMIT 1").get(id);
    const bindingReference = rawDb.prepare('SELECT 1 FROM consumer_bindings WHERE semantic_condition_id = ? LIMIT 1').get(id);
    if (routeReference || bindingReference) return reply.code(409).send({ error: 'semantic_condition_referenced' });
    await db.delete(semanticConditions).where(eq(semanticConditions.id, id));
    return { ok: true };
  });
}
