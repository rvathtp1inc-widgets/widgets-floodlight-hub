import { and, eq, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { activeTimers, commandLogs, floodlights, groupMemberships } from '../../db/schema.js';
import { shellyService } from '../shelly/shellyService.js';
import { decryptString } from '../../lib/secrets.js';

export class TimerService {
  private interval?: NodeJS.Timeout;
  private running = false;

  start(pollSeconds: number): void {
    if (this.interval) return;
    this.running = true;
    this.interval = setInterval(() => {
      this.processExpired().catch(() => undefined);
    }, pollSeconds * 1000);
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  async createOrRefreshTimer(targetType: 'group' | 'floodlight', targetId: number, seconds: number, sourceEventId?: number) {
    const now = DateTime.utc();
    const expires = now.plus({ seconds }).toISO()!;
    const existing = await db.query.activeTimers.findFirst({
      where: and(eq(activeTimers.targetType, targetType), eq(activeTimers.targetId, targetId), eq(activeTimers.active, true))
    });
    if (existing) {
      await db.update(activeTimers).set({ expiresAt: expires, updatedAt: now.toISO()! }).where(eq(activeTimers.id, existing.id));
      return existing.id;
    }
    const result = await db.insert(activeTimers).values({
      targetType,
      targetId,
      startedAt: now.toISO()!,
      expiresAt: expires,
      sourceEventId,
      active: true
    }).returning({ id: activeTimers.id });
    return result[0].id;
  }

  private async processExpired() {
    const now = DateTime.utc().toISO()!;
    const expired = await db.select().from(activeTimers).where(and(eq(activeTimers.active, true), lte(activeTimers.expiresAt, now)));
    for (const timer of expired) {
      if (timer.targetType === 'group') {
        await this.expireGroup(timer.targetId);
      }
      if (timer.targetType === 'floodlight') {
        await this.expireFloodlight(timer.targetId);
      }
      await db.update(activeTimers).set({ active: false, updatedAt: now }).where(eq(activeTimers.id, timer.id));
    }
  }

  private async expireGroup(groupId: number) {
    const members = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, groupId));
    for (const member of members) {
      await this.expireFloodlight(member.floodlightId);
    }
  }

  private async expireFloodlight(floodlightId: number) {
    const light = await db.query.floodlights.findFirst({ where: eq(floodlights.id, floodlightId) });
    if (!light) return;
    if (light.manualOverrideMode === 'force_on') return;
    const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
    try {
      const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, false, password);
      await db.update(floodlights).set({ lastKnownOutput: false, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, light.id));
      await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'off', success: true, responseSummary: JSON.stringify(response) });
    } catch (error) {
      await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'off', success: false, errorText: (error as Error).message });
    }
  }
}
