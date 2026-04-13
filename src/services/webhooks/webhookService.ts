import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { floodlights, groupMemberships, groups, hubSettings } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';
import { insertCommandLogWithRetention, insertEventLogWithRetention } from '../diagnostics/logRetentionService.js';
import { evaluateFloodlightPolicy, evaluateGroupPolicy } from '../policy/policyService.js';
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
  const floodlight = group ? null : await db.query.floodlights.findFirst({ where: eq(floodlights.webhookKey, input.webhookKey) });
  const headerName = settings.defaultWebhookHeaderName.toLowerCase();
  const providedSecret = String(input.headers[headerName] ?? '');
  const encryptedSecret = group?.sharedSecretEncrypted ?? floodlight?.sharedSecretEncrypted;
  const expectedSecret = encryptedSecret ? decryptString(encryptedSecret) : undefined;
  const targetType = group ? 'group' : floodlight ? 'floodlight' : null;
  const targetId = group?.id ?? floodlight?.id ?? null;
  const authValid = !!targetType && (!expectedSecret || expectedSecret === providedSecret);

  const decision = !targetType
    ? { accepted: false, reason: 'group_not_found' }
    : !authValid
      ? { accepted: false, reason: 'invalid_secret' }
      : group
        ? await evaluateGroupPolicy(group.id)
        : await evaluateFloodlightPolicy(floodlight!.id);

  const event = await insertEventLogWithRetention({
    webhookKey: input.webhookKey,
    targetType,
    targetId,
    httpMethod: input.method,
    remoteIp: input.remoteIp,
    headerSummary: JSON.stringify({ [headerName]: providedSecret ? 'present' : 'missing' }),
    payloadRaw: input.payload ? JSON.stringify(input.payload) : null,
    authResult: authValid ? 'valid' : 'invalid',
    decision: decision.accepted ? 'accepted' : 'rejected',
    decisionReason: decision.reason
  });

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
        await insertCommandLogWithRetention({ floodlightId: light.id, commandType: 'on', success: true, responseSummary: JSON.stringify(response) });
        activated.push(light.id);
      } catch (error) {
        skipped.push({ floodlightId: light.id, reason: 'command_failed' });
        await insertCommandLogWithRetention({ floodlightId: light.id, commandType: 'on', success: false, errorText: (error as Error).message });
      }
    }
    await input.timerService.createOrRefreshGroupTimer(group.id, group.autoOffSeconds, event[0].id);
  }

  if (decision.accepted && floodlight) {
    const light = await db.query.floodlights.findFirst({ where: and(eq(floodlights.id, floodlight.id), eq(floodlights.automationEnabled, true)) });
    if (light) {
      if (light.manualOverrideMode === 'force_off' || light.manualOverrideMode === 'suspended') {
        skipped.push({ floodlightId: light.id, reason: light.manualOverrideMode });
      } else {
        const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
        try {
          const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, true, password);
          await db.update(floodlights).set({ lastKnownOutput: true, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, light.id));
          await insertCommandLogWithRetention({ floodlightId: light.id, commandType: 'on', success: true, responseSummary: JSON.stringify(response) });
          activated.push(light.id);
        } catch (error) {
          skipped.push({ floodlightId: light.id, reason: 'command_failed' });
          await insertCommandLogWithRetention({ floodlightId: light.id, commandType: 'on', success: false, errorText: (error as Error).message });
        }
      }

      if (light.autoOffSeconds > 0) {
        await input.timerService.createOrRefreshFloodlightTimer(light.id, light.autoOffSeconds, event[0].id);
      }
    }
  }

  return {
    groupId: group?.id,
    floodlightId: floodlight?.id,
    webhookKey: input.webhookKey,
    accepted: decision.accepted,
    reason: decision.reason,
    activatedFloodlights: activated,
    skipped
  };
}
