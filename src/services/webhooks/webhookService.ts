import { eq } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client.js';
import { floodlights, groups, hubSettings } from '../../db/schema.js';
import { decryptString } from '../../lib/secrets.js';
import { insertEventLogWithRetention } from '../diagnostics/logRetentionService.js';
import { IngressEventDispatcher } from '../ingress/ingressEventDispatcher.js';
import { ProtectSourceSyncService } from '../protectApi/protectSourceSyncService.js';
import {
  extractWebhookCameraId,
  normalizeWebhookEvent
} from './normalizeWebhookEvent.js';

export async function handleGroupWebhook(input: {
  webhookKey: string;
  method: string;
  remoteIp?: string;
  headers: Record<string, unknown>;
  payload?: unknown;
  logger: FastifyBaseLogger;
  ingressEventDispatcher: IngressEventDispatcher;
  protectSourceSyncService: ProtectSourceSyncService;
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
  const sharedSecretValidated = !!targetType && (!expectedSecret || expectedSecret === providedSecret);
  const receivedAt = new Date().toISOString();

  const cameraId = extractWebhookCameraId(input.payload);
  let resolvedSource = null;

  if (cameraId) {
    try {
      resolvedSource = await input.protectSourceSyncService.resolveSourceByCameraId(cameraId);
      if (resolvedSource) {
        input.logger.info(
          {
            webhookKey: input.webhookKey,
            cameraId,
            targetHintType: targetType,
            targetHintId: targetId,
            resolvedSourceId: resolvedSource.sourceId
          },
          'Webhook camera resolved to a protect source before unified ingress publish.'
        );
      } else {
        input.logger.warn(
          {
            webhookKey: input.webhookKey,
            cameraId,
            targetHintType: targetType,
            targetHintId: targetId
          },
          'Webhook camera id did not resolve to a protect source; continuing normalization.'
        );
      }
    } catch (error) {
      input.logger.warn(
        {
          webhookKey: input.webhookKey,
          cameraId,
          err: error
        },
        'Webhook source resolution failed; continuing normalization without resolved source.'
      );
    }
  } else {
    input.logger.warn(
      {
        webhookKey: input.webhookKey,
        targetHintType: targetType,
        targetHintId: targetId
      },
      'Webhook payload did not include a usable camera id; continuing normalization without resolved source.'
    );
  }

  const normalizedEvent = normalizeWebhookEvent({
    webhookKey: input.webhookKey,
    payload: input.payload,
    receivedAt,
    targetHintType: targetType,
    targetHintId: targetId,
    sharedSecretValidated,
    resolvedSource
  });

  await input.ingressEventDispatcher.publish(normalizedEvent);

  const diagnosticsReason = !targetType
    ? 'target_not_found'
    : !sharedSecretValidated
      ? 'invalid_secret'
      : 'diagnostics_only_phase';

  await insertEventLogWithRetention({
    webhookKey: input.webhookKey,
    targetType,
    targetId,
    httpMethod: input.method,
    remoteIp: input.remoteIp,
    headerSummary: JSON.stringify({ [headerName]: providedSecret ? 'present' : 'missing' }),
    payloadRaw: input.payload ? JSON.stringify(input.payload) : null,
    authResult: sharedSecretValidated ? 'valid' : 'invalid',
    decision: 'rejected',
    decisionReason: diagnosticsReason
  });

  return {
    groupId: group?.id,
    floodlightId: floodlight?.id,
    webhookKey: input.webhookKey,
    accepted: false,
    reason: diagnosticsReason,
    diagnosticsOnly: true,
    published: true,
    cameraId: normalizedEvent.cameraId,
    resolvedSourceId: resolvedSource?.sourceId ?? null,
    activatedFloodlights: [],
    skipped: []
  };
}
