import { asc, eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db, rawDb } from '../db/client.js';
import { consumerBindings, semanticConditions } from '../db/schema.js';

type Binding = { panelKey: 'default'; zoneNumber: number };
function isObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function parseBinding(value: unknown): Binding | null {
  if (!isObject(value) || value.panelKey !== 'default' || !Number.isInteger(value.zoneNumber)) return null;
  const zoneNumber = value.zoneNumber as number;
  return zoneNumber >= 1 && zoneNumber <= 208 ? { panelKey: 'default', zoneNumber } : null;
}
function publicBinding(row: typeof consumerBindings.$inferSelect) {
  return { ...row, binding: JSON.parse(row.bindingJson) as Binding, bindingJson: undefined };
}
function addressConflict(binding: Binding, excludeId?: number): boolean {
  return !!rawDb.prepare(`SELECT 1 FROM consumer_bindings
    WHERE enabled = 1 AND consumer_type = 'virtual_security_panel'
      AND json_extract(binding_json, '$.panelKey') = ?
      AND json_extract(binding_json, '$.zoneNumber') = ?
      AND (? IS NULL OR id <> ?) LIMIT 1`).get(binding.panelKey, binding.zoneNumber, excludeId ?? null, excludeId ?? null);
}
function constraint(error: unknown): boolean { return (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') === true; }

export async function consumerBindingRoutes(app: FastifyInstance) {
  app.get('/api/consumer-bindings', async (request) => {
    const query = request.query as { semanticConditionId?: string };
    const rows = query.semanticConditionId
      ? await db.select().from(consumerBindings).where(eq(consumerBindings.semanticConditionId, Number(query.semanticConditionId))).orderBy(asc(consumerBindings.id))
      : await db.select().from(consumerBindings).orderBy(asc(consumerBindings.id));
    return rows.map(publicBinding);
  });
  app.get('/api/consumer-bindings/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = await db.query.consumerBindings.findFirst({ where: eq(consumerBindings.id, id) });
    return row ? publicBinding(row) : reply.code(404).send({ error: 'not_found' });
  });
  app.post('/api/consumer-bindings', async (request, reply) => {
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const semanticConditionId = request.body.semanticConditionId;
    const consumerType = request.body.consumerType;
    const binding = parseBinding(request.body.binding);
    const enabled = request.body.enabled ?? true;
    if (!Number.isInteger(semanticConditionId) || (semanticConditionId as number) <= 0 || consumerType !== 'virtual_security_panel' || !binding || typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_consumer_binding' });
    }
    const condition = await db.query.semanticConditions.findFirst({ where: eq(semanticConditions.id, semanticConditionId as number) });
    if (!condition) return reply.code(400).send({ error: 'invalid_semantic_condition_reference' });
    if (enabled && addressConflict(binding)) return reply.code(409).send({ error: 'consumer_binding_address_conflict' });
    try {
      const inserted = await db.insert(consumerBindings).values({ semanticConditionId: semanticConditionId as number, consumerType, bindingJson: JSON.stringify(binding), enabled }).returning();
      return reply.code(201).send(publicBinding(inserted[0]));
    } catch (error) {
      if (constraint(error)) return reply.code(409).send({ error: 'consumer_binding_conflict' });
      throw error;
    }
  });
  app.patch('/api/consumer-bindings/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!isObject(request.body)) return reply.code(400).send({ error: 'invalid_body' });
    const existing = await db.query.consumerBindings.findFirst({ where: eq(consumerBindings.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    if ('semanticConditionId' in request.body) return reply.code(400).send({ error: 'semantic_condition_id_immutable' });
    if ('consumerType' in request.body) return reply.code(400).send({ error: 'consumer_type_immutable' });
    const binding = 'binding' in request.body ? parseBinding(request.body.binding) : JSON.parse(existing.bindingJson) as Binding;
    const enabled = 'enabled' in request.body ? request.body.enabled : existing.enabled;
    if (!binding || typeof enabled !== 'boolean') return reply.code(400).send({ error: 'invalid_consumer_binding' });
    if (enabled && addressConflict(binding, id)) return reply.code(409).send({ error: 'consumer_binding_address_conflict' });
    try {
      const updated = await db.update(consumerBindings).set({ bindingJson: JSON.stringify(binding), enabled, updatedAt: DateTime.utc().toISO()! }).where(eq(consumerBindings.id, id)).returning();
      return publicBinding(updated[0]);
    } catch (error) {
      if (constraint(error)) return reply.code(409).send({ error: 'consumer_binding_conflict' });
      throw error;
    }
  });
  app.delete('/api/consumer-bindings/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const existing = await db.query.consumerBindings.findFirst({ where: eq(consumerBindings.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await db.delete(consumerBindings).where(eq(consumerBindings.id, id));
    return { ok: true };
  });
}
