import { FastifyBaseLogger } from 'fastify';
import { RouteEvaluationMatch } from '../ingress/routeEvaluatorSubscriber.js';
import { TimerService } from '../timers/timerService.js';
import { LifecycleGatedRouteEvaluationHandler } from './lifecycleExecutionGate.js';
import { SupportedExecutionTargetType, TargetExecutor } from './targetExecutor.js';

type RejectedReason =
  | 'route_unresolved'
  | 'route_disabled'
  | 'missing_target_id'
  | 'unsupported_target_type'
  | 'access_execution_not_supported'
  | 'invalid_webhook_secret';

const SUPPORTED_TARGET_TYPES = new Set<string>(['floodlight', 'group']);

function eventSummary(event: Parameters<LifecycleGatedRouteEvaluationHandler>[0]['event']) {
  return {
    source: event.source,
    ingressType: event.ingressType,
    eventId: event.eventId,
    eventType: event.eventType,
    eventClass: event.eventClass,
    cameraId: event.cameraId,
    objectTypes: event.objectTypes,
    lifecycle: event.lifecycle ?? null,
    resolvedSource: event.resolvedSource
      ? { sourceType: event.resolvedSource.sourceType, sourceId: event.resolvedSource.sourceId }
      : null
  };
}

function getNonExecutableReason(match: RouteEvaluationMatch, source: string, sharedSecretValidated?: boolean): RejectedReason | null {
  if (source === 'access') {
    return 'access_execution_not_supported';
  }

  if (source === 'protect_webhook' && sharedSecretValidated !== true) {
    return 'invalid_webhook_secret';
  }

  if (match.bindingStatus !== 'resolved') {
    return 'route_unresolved';
  }

  if (match.enabled !== true) {
    return 'route_disabled';
  }

  if (!match.targetType || !SUPPORTED_TARGET_TYPES.has(match.targetType)) {
    return 'unsupported_target_type';
  }

  if (match.targetId === null) {
    return 'missing_target_id';
  }

  return null;
}

export function registerExecutionPlannerSubscriber(input: {
  logger: FastifyBaseLogger;
  timerService: TimerService;
  executors: TargetExecutor[];
}): LifecycleGatedRouteEvaluationHandler {
  const diagnosticsLogger = input.logger.child({ service: 'executionPlanner' });
  const executors = new Map<SupportedExecutionTargetType, TargetExecutor>(
    input.executors.map((executor) => [executor.targetType, executor])
  );

  return async (evaluation) => {
    if (!evaluation.lifecycleGate.triggerAllowed) {
      diagnosticsLogger.info(
        {
          event: eventSummary(evaluation.event),
          lifecycleGate: evaluation.lifecycleGate,
          accepted: false,
          reason: evaluation.lifecycleGate.skipReason,
          activatedTargets: [],
          skippedTargets: []
        },
        'Route execution rejected by lifecycle gate before target executor.'
      );
      return;
    }

    for (const match of evaluation.matches) {
      const rejectedReason = getNonExecutableReason(
        match,
        evaluation.event.source,
        evaluation.event.precision?.sharedSecretValidated
      );

      if (rejectedReason) {
        diagnosticsLogger.info(
          {
            routeId: match.routeId,
            event: eventSummary(evaluation.event),
            targetType: match.targetType,
            targetId: match.targetId,
            accepted: false,
            reason: rejectedReason,
            activatedTargets: [],
            skippedTargets: []
          },
          'Route execution rejected before target executor.'
        );
        continue;
      }

      const targetType = match.targetType as SupportedExecutionTargetType;
      const targetId = match.targetId as number;
      const executor = executors.get(targetType);

      if (!executor) {
        diagnosticsLogger.info(
          {
            routeId: match.routeId,
            event: eventSummary(evaluation.event),
            targetType,
            targetId,
            accepted: false,
            reason: 'unsupported_target_type',
            activatedTargets: [],
            skippedTargets: []
          },
          'Route execution rejected because no target executor is registered.'
        );
        continue;
      }

      try {
        const result = await executor.execute({
          routeId: match.routeId,
          event: evaluation.event,
          targetType,
          targetId,
          timerService: input.timerService
        });

        diagnosticsLogger.info(
          {
            routeId: match.routeId,
            event: eventSummary(evaluation.event),
            targetType,
            targetId,
            accepted: result.accepted,
            reason: result.reason,
            activatedTargets: result.activatedTargets,
            skippedTargets: result.skippedTargets
          },
          'Route execution target executor completed.'
        );
      } catch (error) {
        diagnosticsLogger.error(
          {
            routeId: match.routeId,
            event: eventSummary(evaluation.event),
            targetType,
            targetId,
            accepted: false,
            reason: 'executor_failed',
            activatedTargets: [],
            skippedTargets: [],
            err: error
          },
          'Route execution target executor failed.'
        );
      }
    }
  };
}
