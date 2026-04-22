import { asc, eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { eventRoutes, floodlights, groups, protectSources } from '../db/schema.js';

const VALID_SOURCE_TYPES = new Set(['protect_source']);
const VALID_TARGET_TYPES = new Set(['floodlight', 'group']);
const VALID_EVENT_CLASSES = new Set(['zone', 'line', 'motion', 'audio', 'unknown']);
const VALID_BINDING_STATUSES = new Set(['resolved', 'unresolved']);

type BindingStatus = 'resolved' | 'unresolved';
type RouteBody = Record<string, unknown>;
type EventRouteRow = typeof eventRoutes.$inferSelect;
type EventRouteDraft = {
  sourceType: string;
  sourceId: number;
  eventClass: string;
  upstreamEventType: string | null;
  objectTypesJson: string | null;
  bindingStatus: BindingStatus;
  targetType: string | null;
  targetId: number | null;
  enabled: boolean;
  notes: string | null;
};

function isPlainObject(value: unknown): value is RouteBody {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonStringArray(value: string | null): string[] | null {
  if (value === null) {
    return null;
  }

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

function normalizeStringArray(value: unknown): string[] | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new Error('objectTypes must be null or an array of strings');
  }

  const deduped = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error('objectTypes must contain only non-empty strings');
    }

    deduped.add(item.trim());
  }

  return [...deduped];
}

function readRequiredString(body: RouteBody, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }

  return value.trim();
}

function readOptionalString(body: RouteBody, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string or null`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readRequiredInteger(body: RouteBody, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be an integer`);
  }

  return value;
}

function readOptionalInteger(body: RouteBody, key: string): number | null | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be an integer or null`);
  }

  return value;
}

function readOptionalBoolean(body: RouteBody, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }

  return value;
}

function readBindingStatus(value: unknown): BindingStatus {
  if (typeof value !== 'string') {
    throw new Error('bindingStatus is required');
  }

  const trimmed = value.trim();
  if (!VALID_BINDING_STATUSES.has(trimmed)) {
    throw new Error(`bindingStatus must be one of: ${[...VALID_BINDING_STATUSES].join(', ')}`);
  }

  return trimmed as BindingStatus;
}

function serializeObjectTypes(objectTypes: string[] | null | undefined): string | null {
  if (objectTypes === undefined) {
    return null;
  }

  if (objectTypes === null) {
    return null;
  }

  return JSON.stringify(objectTypes);
}

async function assertSourceReferenceExists(sourceType: string, sourceId: number) {
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    throw new Error(`sourceType must be one of: ${[...VALID_SOURCE_TYPES].join(', ')}`);
  }

  const source = await db.query.protectSources.findFirst({ where: eq(protectSources.id, sourceId) });
  if (!source) {
    throw new Error('sourceId does not reference an existing protect source');
  }
}

async function assertTargetReferenceExists(targetType: string, targetId: number) {
  if (targetType === 'floodlight') {
    const target = await db.query.floodlights.findFirst({ where: eq(floodlights.id, targetId) });
    if (!target) {
      throw new Error('targetId does not reference an existing floodlight');
    }

    return;
  }

  const target = await db.query.groups.findFirst({ where: eq(groups.id, targetId) });
  if (!target) {
    throw new Error('targetId does not reference an existing group');
  }
}

async function validateRouteDraft(route: EventRouteDraft) {
  if (!VALID_EVENT_CLASSES.has(route.eventClass)) {
    throw new Error(`eventClass must be one of: ${[...VALID_EVENT_CLASSES].join(', ')}`);
  }

  await assertSourceReferenceExists(route.sourceType, route.sourceId);

  const hasTargetType = route.targetType !== null;
  const hasTargetId = route.targetId !== null;
  if (hasTargetType !== hasTargetId) {
    throw new Error('targetType and targetId must both be provided or both be null');
  }

  if (route.targetType !== null && !VALID_TARGET_TYPES.has(route.targetType)) {
    throw new Error(`targetType must be one of: ${[...VALID_TARGET_TYPES].join(', ')}`);
  }

  if (route.bindingStatus === 'resolved') {
    if (route.targetType === null || route.targetId === null) {
      throw new Error('resolved routes require targetType and targetId');
    }

    await assertTargetReferenceExists(route.targetType, route.targetId);
  }
}

function toPublicEventRoute(row: EventRouteRow) {
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    eventClass: row.eventClass,
    upstreamEventType: row.upstreamEventType,
    objectTypes: parseJsonStringArray(row.objectTypesJson),
    bindingStatus: row.bindingStatus as BindingStatus,
    targetType: row.targetType,
    targetId: row.targetId,
    enabled: row.enabled,
    isExecutable: row.bindingStatus === 'resolved' && row.enabled === true,
    notes: row.notes
  };
}

function buildExistingDraft(row: EventRouteRow): EventRouteDraft {
  return {
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    eventClass: row.eventClass,
    upstreamEventType: row.upstreamEventType,
    objectTypesJson: row.objectTypesJson,
    bindingStatus: row.bindingStatus as BindingStatus,
    targetType: row.targetType,
    targetId: row.targetId,
    enabled: row.enabled,
    notes: row.notes
  };
}

export async function eventRouteRoutes(app: FastifyInstance) {
  app.get('/api/routes', async () => {
    const rows = await db.select().from(eventRoutes).orderBy(asc(eventRoutes.id));
    return rows.map((row) => toPublicEventRoute(row));
  });

  app.post('/api/routes', async (request, reply) => {
    if (!isPlainObject(request.body)) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    try {
      const sourceType = readRequiredString(request.body, 'sourceType');
      const sourceId = readRequiredInteger(request.body, 'sourceId');
      const eventClass = readRequiredString(request.body, 'eventClass');
      const upstreamEventType = readOptionalString(request.body, 'upstreamEventType') ?? null;
      const objectTypes = normalizeStringArray(request.body.objectTypes);
      const bindingStatus = readBindingStatus(request.body.bindingStatus);
      const hasTargetFields = request.body.targetType !== undefined || request.body.targetId !== undefined;
      const targetType = hasTargetFields ? readOptionalString(request.body, 'targetType') ?? null : null;
      const targetId = hasTargetFields ? readOptionalInteger(request.body, 'targetId') ?? null : null;
      const enabled =
        readOptionalBoolean(request.body, 'enabled') ?? (bindingStatus === 'unresolved' ? false : true);
      const notes = readOptionalString(request.body, 'notes') ?? null;

      const route: EventRouteDraft = {
        sourceType,
        sourceId,
        eventClass,
        upstreamEventType,
        objectTypesJson: serializeObjectTypes(objectTypes),
        bindingStatus,
        targetType,
        targetId,
        enabled,
        notes
      };

      await validateRouteDraft(route);

      const inserted = await db.insert(eventRoutes).values(route).returning();
      return toPublicEventRoute(inserted[0]);
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_route', details: (error as Error).message });
    }
  });

  app.patch('/api/routes/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    if (!isPlainObject(request.body)) {
      return reply.code(400).send({ error: 'invalid_body' });
    }

    const existing = await db.query.eventRoutes.findFirst({ where: eq(eventRoutes.id, id) });
    if (!existing) {
      return reply.code(404).send({ error: 'not_found' });
    }

    try {
      const targetFieldCount = Number(request.body.targetType !== undefined) + Number(request.body.targetId !== undefined);
      if (targetFieldCount === 1) {
        throw new Error('targetType and targetId must be updated together');
      }

      const updates: Partial<typeof eventRoutes.$inferInsert> = {};
      const nextRoute = buildExistingDraft(existing);

      if (request.body.sourceType !== undefined) {
        nextRoute.sourceType = readRequiredString(request.body, 'sourceType');
        updates.sourceType = nextRoute.sourceType;
      }

      if (request.body.sourceId !== undefined) {
        nextRoute.sourceId = readRequiredInteger(request.body, 'sourceId');
        updates.sourceId = nextRoute.sourceId;
      }

      if (request.body.eventClass !== undefined) {
        nextRoute.eventClass = readRequiredString(request.body, 'eventClass');
        updates.eventClass = nextRoute.eventClass;
      }

      if (request.body.upstreamEventType !== undefined) {
        nextRoute.upstreamEventType = readOptionalString(request.body, 'upstreamEventType') ?? null;
        updates.upstreamEventType = nextRoute.upstreamEventType;
      }

      if (request.body.objectTypes !== undefined) {
        const objectTypes = normalizeStringArray(request.body.objectTypes);
        nextRoute.objectTypesJson = serializeObjectTypes(objectTypes);
        updates.objectTypesJson = nextRoute.objectTypesJson;
      }

      if (request.body.bindingStatus !== undefined) {
        nextRoute.bindingStatus = readBindingStatus(request.body.bindingStatus);
        updates.bindingStatus = nextRoute.bindingStatus;
      }

      if (targetFieldCount === 2) {
        nextRoute.targetType = readOptionalString(request.body, 'targetType') ?? null;
        nextRoute.targetId = readOptionalInteger(request.body, 'targetId') ?? null;
        updates.targetType = nextRoute.targetType;
        updates.targetId = nextRoute.targetId;
      }

      if (request.body.enabled !== undefined) {
        nextRoute.enabled = readOptionalBoolean(request.body, 'enabled') ?? nextRoute.enabled;
        updates.enabled = nextRoute.enabled;
      }

      if (request.body.notes !== undefined) {
        nextRoute.notes = readOptionalString(request.body, 'notes') ?? null;
        updates.notes = nextRoute.notes;
      }

      await validateRouteDraft(nextRoute);

      if (Object.keys(updates).length === 0) {
        return toPublicEventRoute(existing);
      }

      const updated = await db.update(eventRoutes).set(updates).where(eq(eventRoutes.id, id)).returning();
      return toPublicEventRoute(updated[0]);
    } catch (error) {
      return reply.code(400).send({ error: 'invalid_route', details: (error as Error).message });
    }
  });

  app.delete('/api/routes/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.code(400).send({ error: 'invalid_id' });
    }

    const existing = await db.query.eventRoutes.findFirst({ where: eq(eventRoutes.id, id) });
    if (!existing) {
      return reply.code(404).send({ error: 'not_found' });
    }

    await db.delete(eventRoutes).where(eq(eventRoutes.id, id));
    return { ok: true };
  });
}
