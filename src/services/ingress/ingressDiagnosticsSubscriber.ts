import { FastifyBaseLogger } from 'fastify';
import { IngressEventDispatcher } from './ingressEventDispatcher.js';
import { NormalizedIngressEvent } from './normalizedEvent.js';

function buildSourceResolution(event: NormalizedIngressEvent) {
  if (event.source === 'access') {
    return {
      status: 'not_applicable' as const,
      reason: 'access_source_has_no_source_resolution'
    };
  }

  if (event.resolvedSource) {
    return {
      status: 'resolved' as const,
      sourceType: event.resolvedSource.sourceType,
      sourceId: event.resolvedSource.sourceId,
      protectCameraId: 'protectCameraId' in event.resolvedSource ? event.resolvedSource.protectCameraId : null
    };
  }

  return {
    status: 'unresolved' as const,
    protectCameraId: event.cameraId,
    reason: event.cameraId
      ? 'protect_source_not_found'
      : event.ingressType === 'webhook'
        ? 'camera_id_unavailable_in_webhook_context'
        : 'camera_id_missing'
  };
}

export function registerIngressDiagnosticsSubscriber(
  dispatcher: IngressEventDispatcher,
  logger: FastifyBaseLogger
): () => void {
  const diagnosticsLogger = logger.child({ service: 'ingressDispatcher' });

  return dispatcher.subscribe(async (event) => {
    const sourceResolution = buildSourceResolution(event);
    const diagnosticsContext = {
      ingressType: event.ingressType,
      source: event.source,
      diagnosticsOnly: event.diagnosticsOnly,
      normalizedEvent: event,
      resolvedSource: event.resolvedSource ?? null,
      precision: event.precision ?? null,
      sourceResolution
    };

    if (sourceResolution.status === 'resolved') {
      diagnosticsLogger.info(
        diagnosticsContext,
        'Unified ingress normalized event published with resolved source.'
      );
      return;
    }

    if (sourceResolution.status === 'not_applicable') {
      diagnosticsLogger.info(
        diagnosticsContext,
        'Unified ingress normalized event published without source resolution requirements.'
      );
      return;
    }

    diagnosticsLogger.warn(
      diagnosticsContext,
      'Unified ingress normalized event published with unresolved source.'
    );
  });
}
