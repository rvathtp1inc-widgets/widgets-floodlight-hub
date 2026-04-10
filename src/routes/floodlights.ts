import { and, eq } from 'drizzle-orm';
import { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { commandLogs, floodlights, groupMemberships } from '../db/schema.js';
import { decryptString, encryptString } from '../lib/secrets.js';
import { shellyService } from '../services/shelly/shellyService.js';

export async function floodlightRoutes(app: FastifyInstance) {
  app.get('/api/floodlights', async () => db.select().from(floodlights));

  app.post('/api/floodlights', async (request, reply) => {
    const body = request.body as { name: string; shellyHost: string; port?: number; authEnabled?: boolean; password?: string; notes?: string };
    if (!body?.name || !body?.shellyHost) return reply.code(400).send({ error: 'name and shellyHost are required' });
    const port = body.port ?? 80;
    const authEnabled = body.authEnabled ?? false;
    const password = authEnabled ? body.password : undefined;

    const health = await shellyService.healthCheck(body.shellyHost, port, 0, password);
    if (!health.ok) return reply.code(400).send({ error: 'shelly_unreachable', details: health.error });

    const status = await shellyService.getStatus(body.shellyHost, port, 0, password);
    const cfg = await shellyService.getConfig(body.shellyHost, port, 0, password);

    const inserted = await db.insert(floodlights).values({
      name: body.name,
      shellyHost: body.shellyHost,
      shellyPort: port,
      authEnabled,
      shellyPasswordEncrypted: password ? encryptString(password) : null,
      notes: body.notes ?? null,
      onlineStatus: 'online',
      lastSeenAt: DateTime.utc().toISO()!,
      lastKnownOutput: Boolean((status as Record<string, unknown>).output)
    }).returning();

    return { floodlight: inserted[0], status, config: cfg };
  });

  app.get('/api/floodlights/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const row = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return row;
  });

  app.patch('/api/floodlights/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = request.body as Record<string, unknown>;
    const existing = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const updates: Record<string, unknown> = { updatedAt: DateTime.utc().toISO() };
    for (const key of ['name', 'shellyHost', 'shellyPort', 'automationEnabled', 'manualOverrideMode', 'overrideUntil', 'notes', 'authEnabled']) {
      if (body[key] !== undefined) updates[key] = body[key];
    }
    if (typeof body.password === 'string') updates.shellyPasswordEncrypted = encryptString(body.password);
    const out = await db.update(floodlights).set(updates).where(eq(floodlights.id, id)).returning();
    return out[0];
  });

  app.delete('/api/floodlights/:id', async (request) => {
    const id = Number((request.params as { id: string }).id);
    await db.delete(groupMemberships).where(eq(groupMemberships.floodlightId, id));
    await db.delete(floodlights).where(eq(floodlights.id, id));
    return { ok: true };
  });

  async function commandOutput(id: number, on: boolean, type: 'on' | 'off', requestSummary?: string) {
    const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!light) return { status: 404, body: { error: 'not_found' } };
    const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
    try {
      const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, on, password);
      await db.update(floodlights).set({ lastKnownOutput: on, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, id));
      await db.insert(commandLogs).values({ floodlightId: id, commandType: type, success: true, requestSummary, responseSummary: JSON.stringify(response) });
      return { status: 200, body: { ok: true, response } };
    } catch (error) {
      await db.insert(commandLogs).values({ floodlightId: id, commandType: type, success: false, requestSummary, errorText: (error as Error).message });
      return { status: 502, body: { error: 'command_failed', details: (error as Error).message } };
    }
  }

  app.post('/api/floodlights/:id/on', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const result = await commandOutput(id, true, 'on');
    return reply.code(result.status).send(result.body);
  });

  app.post('/api/floodlights/:id/off', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const result = await commandOutput(id, false, 'off');
    return reply.code(result.status).send(result.body);
  });

  app.post('/api/floodlights/:id/test', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!light) return reply.code(404).send({ error: 'not_found' });
    const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
    const result = await shellyService.healthCheck(light.shellyHost, light.shellyPort, light.relayId, password);
    return result;
  });

  app.post('/api/floodlights/:id/standardize', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!light) return reply.code(404).send({ error: 'not_found' });
    const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
    try {
      const cfg = await shellyService.standardizeConfig(light.shellyHost, light.shellyPort, light.relayId, password);
      await db.insert(commandLogs).values({ floodlightId: id, commandType: 'standardize', success: true, responseSummary: JSON.stringify(cfg) });
      return { ok: true, config: cfg };
    } catch (error) {
      await db.insert(commandLogs).values({ floodlightId: id, commandType: 'standardize', success: false, errorText: (error as Error).message });
      return reply.code(502).send({ error: 'standardize_failed', details: (error as Error).message });
    }
  });

  app.get('/api/floodlights/:id/status', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, id) });
    if (!light) return reply.code(404).send({ error: 'not_found' });
    const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
    try {
      const [status, cfg] = await Promise.all([
        shellyService.getStatus(light.shellyHost, light.shellyPort, light.relayId, password),
        shellyService.getConfig(light.shellyHost, light.shellyPort, light.relayId, password)
      ]);
      await db.update(floodlights).set({ onlineStatus: 'online', lastSeenAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, id));
      return { status, config: cfg };
    } catch (error) {
      await db.update(floodlights).set({ onlineStatus: 'offline', lastCommandStatus: (error as Error).message }).where(eq(floodlights.id, id));
      return reply.code(502).send({ error: 'status_failed', details: (error as Error).message });
    }
  });
}
