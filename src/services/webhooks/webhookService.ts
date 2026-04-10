import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { commandLogs, eventLogs, floodlights, groupMemberships, groups, hubSettings } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';
import { evaluateGroupPolicy } from '../policy/policyService.js';
import { shellyService } from '../shelly/shellyService.js';
import { TimerService } from '../timers/timerService.js';

export async function handleGroupWebhook(input: {
  webhookKey: string;
  method: string;
  remoteIp?: string;
  headers: Record<string, unknown>;
  payload?: unknown;
  timerService: TimerService;
}) {
  const settings = (await db.query.hubSettings.findFirst({ where: eq(hubSettings.id, 1) })) ?? {
    defaultWebhookHeaderName: 'X-Widgets-Secret'
  };

  const group = await db.query.groups.findFirst({ where: eq(groups.webhookKey, input.webhookKey) });
  const headerName = settings.defaultWebhookHeaderName.toLowerCase();
  const providedSecret = String(input.headers[headerName] ?? '');
  const expectedSecret = group?.sharedSecretEncrypted ? decryptString(group.sharedSecretEncrypted) : undefined;
  const authValid = !!group && (!expectedSecret || expectedSecret === providedSecret);

  const decision = !group ? { accepted: false, reason: 'group_not_found' } : !authValid ? { accepted: false, reason: 'invalid_secret' } : await evaluateGroupPolicy(group.id);

  const event = await db.insert(eventLogs).values({
    webhookKey: input.webhookKey,
    targetType: group ? 'group' : null,
    targetId: group?.id ?? null,
    httpMethod: input.method,
    remoteIp: input.remoteIp,
    headerSummary: JSON.stringify({ [headerName]: providedSecret ? 'present' : 'missing' }),
    payloadRaw: input.payload ? JSON.stringify(input.payload) : null,
    authResult: authValid ? 'valid' : 'invalid',
    decision: decision.accepted ? 'accepted' : 'rejected',
    decisionReason: decision.reason
  }).returning({ id: eventLogs.id });

  const activated: number[] = [];
  const skipped: Array<{ floodlightId: number; reason: string }> = [];
  if (decision.accepted && group) {
    const members = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, group.id));
    for (const member of members) {
      const light = await db.query.floodlights.findFirst({ where: and(eq(floodlights.id, member.floodlightId), eq(floodlights.automationEnabled, true)) });
      if (!light) continue;
      if (light.manualOverrideMode === 'force_off' || light.manualOverrideMode === 'suspended') {
        skipped.push({ floodlightId: light.id, reason: light.manualOverrideMode });
        continue;
      }
      const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
      try {
        const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, true, password);
        await db.update(floodlights).set({ lastKnownOutput: true, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, light.id));
        await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'on', success: true, responseSummary: JSON.stringify(response) });
        activated.push(light.id);
      } catch (error) {
        skipped.push({ floodlightId: light.id, reason: 'command_failed' });
        await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'on', success: false, errorText: (error as Error).message });
      }
    }
    await input.timerService.createOrRefreshGroupTimer(group.id, group.autoOffSeconds, event[0].id);
  }

  return {
    groupId: group?.id,
    webhookKey: input.webhookKey,
    accepted: decision.accepted,
    reason: decision.reason,
    activatedFloodlights: activated,
    skipped
  };
}
