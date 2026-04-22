import { FastifyBaseLogger } from 'fastify';
import { IngressEventDispatcher } from './ingressEventDispatcher.js';
import { NormalizedIngressEvent } from './normalizedEvent.js';

function buildSourceResolution(event: NormalizedIngressEvent) {
  if (event.resolvedSource) {
    return {
      status: 'resolved' as const,
      sourceType: event.resolvedSource.sourceType,
      sourceId: event.resolvedSource.sourceId,
      protectCameraId: event.resolvedSource.protectCameraId
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
    const diagnosticsContext = {
      ingressType: event.ingressType,
      source: event.source,
      diagnosticsOnly: event.diagnosticsOnly,
      normalizedEvent: event,
      resolvedSource: event.resolvedSource ?? null,
      precision: event.precision ?? null,
      sourceResolution: buildSourceResolution(event)
    };

    if (event.resolvedSource) {
      diagnosticsLogger.info(
        diagnosticsContext,
        'Unified ingress normalized event published with resolved source.'
      );
      return;
    }

    diagnosticsLogger.warn(
      diagnosticsContext,
      'Unified ingress normalized event published with unresolved source.'
    );
  });
}
