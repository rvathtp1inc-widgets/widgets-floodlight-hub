import { and, eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { groupMemberships, groups } from '../db/schema.js';
import { encryptString } from '../lib/secrets.js';

async function setMembers(groupId: number, ids: number[]) {
  await db.delete(groupMemberships).where(eq(groupMemberships.groupId, groupId));
  if (ids.length > 0) {
    await db.insert(groupMemberships).values(ids.map((id) => ({ groupId, floodlightId: id })));
  }
}

export async function groupRoutes(app: FastifyInstance) {
  app.get('/api/groups', async () => db.select().from(groups));

  app.post('/api/groups', async (request, reply) => {
    const body = request.body as {
      name: string; webhookKey: string; sharedSecret?: string; automationEnabled?: boolean; testModeEnabled?: boolean; testModeUntil?: string | null;
      scheduleMode?: string; scheduleJson?: unknown; autoOffSeconds?: number; debounceSeconds?: number; cooldownSeconds?: number;
      memberFloodlightIds?: number[]; notes?: string;
    };
    if (!body.name || !body.webhookKey) return reply.code(400).send({ error: 'name and webhookKey required' });
    const inserted = await db.insert(groups).values({
      name: body.name,
      webhookKey: body.webhookKey,
      sharedSecretEncrypted: body.sharedSecret ? encryptString(body.sharedSecret) : null,
      automationEnabled: body.automationEnabled ?? true,
      testModeEnabled: body.testModeEnabled ?? false,
      testModeUntil: body.testModeUntil ?? null,
      scheduleMode: body.scheduleMode ?? 'always',
      scheduleJson: JSON.stringify(body.scheduleJson ?? {}),
      autoOffSeconds: body.autoOffSeconds ?? 120,
      debounceSeconds: body.debounceSeconds ?? 0,
      cooldownSeconds: body.cooldownSeconds ?? 0,
      notes: body.notes ?? null
    }).returning();

    await setMembers(inserted[0].id, body.memberFloodlightIds ?? []);
    return inserted[0];
  });

  app.get('/api/groups/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
    if (!group) return reply.code(404).send({ error: 'not_found' });
    const members = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, id));
    return { ...group, memberFloodlightIds: members.map((m) => m.floodlightId) };
  });

  app.patch('/api/groups/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as Record<string, unknown>;
    const existing = await db.query.groups.findFirst({ where: eq(groups.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const updates: Record<string, unknown> = { updatedAt: DateTime.utc().toISO() };
    for (const key of ['name', 'webhookKey', 'automationEnabled', 'testModeEnabled', 'testModeUntil', 'scheduleMode', 'autoOffSeconds', 'debounceSeconds', 'cooldownSeconds', 'notes']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (body.scheduleJson !== undefined) updates.scheduleJson = JSON.stringify(body.scheduleJson);
    if (typeof body.sharedSecret === 'string') updates.sharedSecretEncrypted = encryptString(body.sharedSecret);
    const out = await db.update(groups).set(updates).where(eq(groups.id, id)).returning();
    if (Array.isArray(body.memberFloodlightIds)) await setMembers(id, body.memberFloodlightIds as number[]);
    return out[0];
  });

  app.delete('/api/groups/:id', async (request) => {
    const id = Number((request.params as { id: string }).id);
    await db.delete(groupMemberships).where(eq(groupMemberships.groupId, id));
    await db.delete(groups).where(eq(groups.id, id));
    return { ok: true };
  });

  app.post('/api/groups/:id/trigger-test', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const group = await db.query.groups.findFirst({ where: eq(groups.id, id) });
    if (!group) return reply.code(404).send({ error: 'not_found' });
    return { webhookUrl: `/api/webhooks/unifi/${group.webhookKey}`, headerName: 'X-Widgets-Secret' };
  });
}
