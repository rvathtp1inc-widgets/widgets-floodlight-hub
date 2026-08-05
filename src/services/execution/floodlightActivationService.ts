import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../../db/client.js';
import { floodlights, groupMemberships, groups } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';
import { insertCommandLogWithRetention, insertEventLogWithRetention } from '../diagnostics/logRetentionService.js';
import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';
import { evaluateFloodlightPolicy, evaluateGroupPolicy } from '../policy/policyService.js';
import { shellyService } from '../shelly/shellyService.js';
import { TimerService } from '../timers/timerService.js';
import { SkippedTarget, TargetExecutionResult } from './targetExecutor.js';

function safeJson(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serialization: 'failed' });
  }
}

function getRouteWebhookKey(routeId: number, event: NormalizedIngressEvent): string {
  return event.precision?.webhookKey ?? `route:${routeId}`;
}

function getRouteRequestSummary(routeId: number, event: NormalizedIngressEvent): string {
  return JSON.stringify({
    routeId,
    source: event.source,
    ingressType: event.ingressType,
    eventId: event.eventId,
    eventType: event.eventType,
    eventClass: event.eventClass
  });
}

async function logRouteEvent(input: {
  routeId: number;
  event: NormalizedIngressEvent;
  targetType: 'floodlight' | 'group';
  targetId: number;
  accepted: boolean;
  reason: string;
}) {
  return insertEventLogWithRetention({
    webhookKey: getRouteWebhookKey(input.routeId, input.event),
    targetType: input.targetType,
    targetId: input.targetId,
    httpMethod: `ROUTE_${input.event.ingressType.toUpperCase()}`,
    remoteIp: null,
    headerSummary: safeJson({
      routeId: input.routeId,
      source: input.event.source,
      eventId: input.event.eventId,
      sharedSecretValidated: input.event.precision?.sharedSecretValidated
    }),
    payloadRaw: safeJson(input.event.raw),
    authResult: input.event.source === 'protect_webhook'
      ? input.event.precision?.sharedSecretValidated === true ? 'valid' : 'invalid'
      : 'not_applicable',
    decision: input.accepted ? 'accepted' : 'rejected',
    decisionReason: input.reason
  });
}

async function activateFloodlight(light: typeof floodlights.$inferSelect, requestSummary: string): Promise<SkippedTarget | null> {
  if (light.manualOverrideMode === 'force_off' || light.manualOverrideMode === 'suspended') {
    return { floodlightId: light.id, reason: light.manualOverrideMode };
  }

  const password = decryptString(light.shellyPasswordEncrypted ?? undefined);

  try {
    const response = await shellyService.setOutput(light.shellyHost, light.shellyPort, light.relayId, true, password);
    await db
      .update(floodlights)
      .set({ lastKnownOutput: true, lastCommandStatus: 'ok', updatedAt: DateTime.utc().toISO()! })
      .where(eq(floodlights.id, light.id));
    await insertCommandLogWithRetention({
      floodlightId: light.id,
      commandType: 'on',
      success: true,
      requestSummary,
      responseSummary: JSON.stringify(response)
    });
    return null;
  } catch (error) {
    await insertCommandLogWithRetention({
      floodlightId: light.id,
      commandType: 'on',
      success: false,
      requestSummary,
      errorText: (error as Error).message
    });
    return { floodlightId: light.id, reason: 'command_failed' };
  }
}

export async function executeFloodlightActivation(input: {
  routeId: number;
  event: NormalizedIngressEvent;
  floodlightId: number;
  timerService: TimerService;
}): Promise<TargetExecutionResult> {
  const decision = await evaluateFloodlightPolicy(input.floodlightId);
  const eventLog = await logRouteEvent({
    routeId: input.routeId,
    event: input.event,
    targetType: 'floodlight',
    targetId: input.floodlightId,
    accepted: decision.accepted,
    reason: decision.reason
  });

  if (!decision.accepted) {
    return { accepted: false, reason: decision.reason, activatedTargets: [], skippedTargets: [] };
  }

  const light = await db.query.floodlights.findFirst({
    where: and(eq(floodlights.id, input.floodlightId), eq(floodlights.automationEnabled, true))
  });

  if (!light) {
    return {
      accepted: true,
      reason: decision.reason,
      activatedTargets: [],
      skippedTargets: [{ floodlightId: input.floodlightId, reason: 'floodlight_not_found_or_automation_disabled' }]
    };
  }

  const skipped = await activateFloodlight(light, getRouteRequestSummary(input.routeId, input.event));
  const skippedTargets = skipped ? [skipped] : [];
  const activatedTargets = skipped ? [] : [light.id];

  if (light.autoOffSeconds > 0) {
    await input.timerService.createOrRefreshFloodlightTimer(light.id, light.autoOffSeconds, eventLog[0]?.id);
  }

  return { accepted: true, reason: decision.reason, activatedTargets, skippedTargets };
}

export async function executeGroupActivation(input: {
  routeId: number;
  event: NormalizedIngressEvent;
  groupId: number;
  timerService: TimerService;
}): Promise<TargetExecutionResult> {
  const decision = await evaluateGroupPolicy(input.groupId);
  const eventLog = await logRouteEvent({
    routeId: input.routeId,
    event: input.event,
    targetType: 'group',
    targetId: input.groupId,
    accepted: decision.accepted,
    reason: decision.reason
  });

  if (!decision.accepted) {
    return { accepted: false, reason: decision.reason, activatedTargets: [], skippedTargets: [] };
  }

  const group = await db.query.groups.findFirst({ where: eq(groups.id, input.groupId) });
  if (!group) {
    return { accepted: true, reason: decision.reason, activatedTargets: [], skippedTargets: [] };
  }

  const activatedTargets: number[] = [];
  const skippedTargets: SkippedTarget[] = [];
  const members = await db.select().from(groupMemberships).where(eq(groupMemberships.groupId, group.id));
  const requestSummary = getRouteRequestSummary(input.routeId, input.event);

  for (const member of members) {
    const light = await db.query.floodlights.findFirst({
      where: and(eq(floodlights.id, member.floodlightId), eq(floodlights.automationEnabled, true))
    });

    if (!light) {
      skippedTargets.push({ floodlightId: member.floodlightId, reason: 'floodlight_not_found_or_automation_disabled' });
      continue;
    }

    const skipped = await activateFloodlight(light, requestSummary);
    if (skipped) {
      skippedTargets.push(skipped);
    } else {
      activatedTargets.push(light.id);
    }
  }

  await input.timerService.createOrRefreshGroupTimer(group.id, group.autoOffSeconds, eventLog[0]?.id);

  return { accepted: true, reason: decision.reason, activatedTargets, skippedTargets };
}
