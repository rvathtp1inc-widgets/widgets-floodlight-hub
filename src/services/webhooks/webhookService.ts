import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { commandLogs, eventLogs, floodlights, groupMemberships, groups, hubSettings } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';
import { evaluateFloodlightPolicy, evaluateGroupPolicy } from '../policy/policyService.js';
import { shellyService } from '../shelly/shellyService.js';
import { TimerService } from '../timers/timerService.js';

function logDecision(input: {
  webhookKey: string;
  method: string;
  remoteIp?: string;
  headerName: string;
  secretPresent: boolean;
  payload?: unknown;
  authValid: boolean;
  targetType: 'group' | 'floodlight' | null;
  targetId: number | null;
  decision: string;
  decisionReason: string;
}) {
  return db.insert(eventLogs).values({
    webhookKey: input.webhookKey,
    targetType: input.targetType,
    targetId: input.targetId,
    httpMethod: input.method,
    remoteIp: input.remoteIp,
    headerSummary: JSON.stringify({ [input.headerName]: input.secretPresent ? 'present' : 'missing' }),
    payloadRaw: input.payload ? JSON.stringify(input.payload) : null,
    authResult: input.authValid ? 'valid' : 'invalid',
    decision: input.decision,
    decisionReason: input.decisionReason
  }).returning({ id: eventLogs.id });
}

export async function handleWebhook(input: {
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

  const headerName = settings.defaultWebhookHeaderName.toLowerCase();
  const providedSecret = String(input.headers[headerName] ?? '');

  const [group, floodlight] = await Promise.all([
    db.query.groups.findFirst({ where: eq(groups.webhookKey, input.webhookKey) }),
    db.query.floodlights.findFirst({ where: eq(floodlights.webhookKey, input.webhookKey) })
  ]);

  if (!group && !floodlight) {
    await logDecision({
      webhookKey: input.webhookKey,
      method: input.method,
      remoteIp: input.remoteIp,
      headerName,
      secretPresent: Boolean(providedSecret),
      payload: input.payload,
      authValid: false,
      targetType: null,
      targetId: null,
      decision: 'rejected',
      decisionReason: 'rejected_target_not_found'
    });
    return { accepted: false, reason: 'rejected_target_not_found' };
  }

  if (group && floodlight) {
    await logDecision({
      webhookKey: input.webhookKey,
      method: input.method,
      remoteIp: input.remoteIp,
      headerName,
      secretPresent: Boolean(providedSecret),
      payload: input.payload,
      authValid: false,
      targetType: null,
      targetId: null,
      decision: 'rejected',
      decisionReason: 'rejected_webhook_key_conflict'
    });
    return { accepted: false, reason: 'rejected_webhook_key_conflict' };
  }

  if (group) {
    const expectedSecret = group.sharedSecretEncrypted ? decryptString(group.sharedSecretEncrypted) : undefined;
    const authValid = !expectedSecret || expectedSecret === providedSecret;
    if (!authValid) {
      await logDecision({ webhookKey: input.webhookKey, method: input.method, remoteIp: input.remoteIp, headerName, secretPresent: Boolean(providedSecret), payload: input.payload, authValid, targetType: 'group', targetId: group.id, decision: 'rejected', decisionReason: 'rejected_auth' });
      return { accepted: false, targetType: 'group', targetId: group.id, reason: 'rejected_auth' };
    }

    const decision = await evaluateGroupPolicy(group.id);
    const event = await logDecision({ webhookKey: input.webhookKey, method: input.method, remoteIp: input.remoteIp, headerName, secretPresent: Boolean(providedSecret), payload: input.payload, authValid, targetType: 'group', targetId: group.id, decision: decision.accepted ? 'accepted' : 'rejected', decisionReason: decision.reason });

    const activated: number[] = [];
    const skipped: Array<{ floodlightId: number; reason: string }> = [];
    if (decision.accepted) {
      const members = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, group.id));
      for (const member of members) {
        const light = await db.query.floodlights.findFirst({ where: and(eq(floodlights.id, member.floodlightId), eq(floodlights.automationEnabled, true)) });
        if (!light) continue;
        if (light.manualOverrideMode === 'force_off' || light.manualOverrideMode === 'suspended') {
          skipped.push({ floodlightId: light.id, reason: 'rejected_override' });
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
      await input.timerService.createOrRefreshTimer('group', group.id, group.autoOffSeconds, event[0].id);
    }

    return { accepted: decision.accepted, targetType: 'group', targetId: group.id, reason: decision.reason, activatedFloodlights: activated, skipped };
  }

  const light = floodlight!;
  const expectedSecret = light.sharedSecretEncrypted ? decryptString(light.sharedSecretEncrypted) : undefined;
  const authValid = !expectedSecret || expectedSecret === providedSecret;
  if (!authValid) {
    await logDecision({ webhookKey: input.webhookKey, method: input.method, remoteIp: input.remoteIp, headerName, secretPresent: Boolean(providedSecret), payload: input.payload, authValid, targetType: 'floodlight', targetId: light.id, decision: 'rejected', decisionReason: 'rejected_auth' });
    return { accepted: false, targetType: 'floodlight', targetId: light.id, reason: 'rejected_auth' };
  }

  const decision = await evaluateFloodlightPolicy(light.id);
  const event = await logDecision({ webhookKey: input.webhookKey, method: input.method, remoteIp: input.remoteIp, headerName, secretPresent: Boolean(providedSecret), payload: input.payload, authValid, targetType: 'floodlight', targetId: light.id, decision: decision.accepted ? 'accepted' : 'rejected', decisionReason: decision.reason });

  if (!decision.accepted) {
    return { accepted: false, targetType: 'floodlight', targetId: light.id, reason: decision.reason };
  }

  const password = decryptString(light.shellyPasswordEncrypted ?? undefined);
  try {
    const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, true, password);
    await db.update(floodlights).set({ lastKnownOutput: true, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! }).where(eq(floodlights.id, light.id));
    await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'on', success: true, responseSummary: JSON.stringify(response) });
    await input.timerService.createOrRefreshTimer('floodlight', light.id, light.autoOffSeconds, event[0].id);
    return { accepted: true, targetType: 'floodlight', targetId: light.id, reason: decision.reason };
  } catch (error) {
    await db.insert(commandLogs).values({ floodlightId: light.id, commandType: 'on', success: false, errorText: (error as Error).message });
    return { accepted: false, targetType: 'floodlight', targetId: light.id, reason: 'command_failed' };
  }
}
