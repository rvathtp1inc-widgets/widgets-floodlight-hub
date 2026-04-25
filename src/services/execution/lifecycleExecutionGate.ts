import { FastifyBaseLogger } from 'fastify';
import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';
import {
  RouteEvaluationHandler,
  RouteEvaluationMatch,
  RouteEvaluationResult
} from '../ingress/routeEvaluatorSubscriber.js';

export type LifecycleIntent = 'trigger' | 'restore' | 'diagnostics_only' | 'unknown';

export interface LifecycleExecutionGateDecision {
  triggerAllowed: boolean;
  restoreAllowed: boolean;
  skipReason: string | null;
  lifecycleIntent: LifecycleIntent;
  rawItemEndDetected: boolean;
}

export interface LifecycleGatedRouteEvaluation extends RouteEvaluationResult {
  lifecycleGate: LifecycleExecutionGateDecision;
}

export type LifecycleGatedRouteEvaluationHandler = (
  result: LifecycleGatedRouteEvaluation
) => void | Promise<void>;

function normalizeLifecycle(lifecycle: string | undefined): string | null {
  if (typeof lifecycle !== 'string') {
    return null;
  }

  const normalized = lifecycle.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function hasRawItemEnd(event: NormalizedIngressEvent): boolean {
  const raw = event.raw;
  if (!raw || typeof raw !== 'object' || !('item' in raw)) {
    return false;
  }

  const item = raw.item;
  return !!item && typeof item === 'object' && 'end' in item;
}

export function classifyLifecycle(event: NormalizedIngressEvent): LifecycleExecutionGateDecision {
  const lifecycle = normalizeLifecycle(event.lifecycle);
  const rawItemEndDetected = hasRawItemEnd(event);

  if (lifecycle === 'add') {
    return {
      triggerAllowed: true,
      restoreAllowed: false,
      skipReason: null,
      lifecycleIntent: 'trigger',
      rawItemEndDetected
    };
  }

  if (lifecycle === 'update') {
    if (rawItemEndDetected) {
      return {
        triggerAllowed: false,
        restoreAllowed: true,
        skipReason: 'lifecycle_update_with_end_restore_only',
        lifecycleIntent: 'restore',
        rawItemEndDetected
      };
    }

    return {
      triggerAllowed: false,
      restoreAllowed: false,
      skipReason: 'lifecycle_update_non_trigger',
      lifecycleIntent: 'diagnostics_only',
      rawItemEndDetected
    };
  }

  // Defensive only: standalone "end" has not been observed from the Protect websocket.
  // Observed Protect restore signal is lifecycle "update" with raw.item.end present.
  if (lifecycle === 'end') {
    return {
      triggerAllowed: false,
      restoreAllowed: true,
      skipReason: 'lifecycle_end_restore_only',
      lifecycleIntent: 'restore',
      rawItemEndDetected
    };
  }

  if (lifecycle === null) {
    if (event.ingressType === 'webhook') {
      return {
        triggerAllowed: true,
        restoreAllowed: false,
        skipReason: null,
        lifecycleIntent: 'trigger',
        rawItemEndDetected
      };
    }

    return {
      triggerAllowed: false,
      restoreAllowed: false,
      skipReason: 'lifecycle_missing_diagnostics_only',
      lifecycleIntent: 'diagnostics_only',
      rawItemEndDetected
    };
  }

  return {
    triggerAllowed: false,
    restoreAllowed: false,
    skipReason: 'lifecycle_unknown_diagnostics_only',
    lifecycleIntent: 'unknown',
    rawItemEndDetected
  };
}

function getExecutableMatchCount(matches: RouteEvaluationMatch[]): number {
  return matches.filter((match) => match.isExecutable).length;
}

function logSkippedExecutableMatches(
  logger: FastifyBaseLogger,
  matches: RouteEvaluationMatch[],
  skipReason: string | null
) {
  if (
    skipReason !== 'lifecycle_update_non_trigger' &&
    skipReason !== 'lifecycle_update_with_end_restore_only' &&
    skipReason !== 'lifecycle_end_restore_only'
  ) {
    return;
  }

  for (const match of matches) {
    if (!match.isExecutable) {
      continue;
    }

    logger.info(
      {
        routeId: match.routeId,
        targetType: match.targetType,
        targetId: match.targetId,
        accepted: false,
        reason: skipReason
      },
      'Route execution skipped by lifecycle gate.'
    );
  }
}

export function registerLifecycleExecutionGate(input: {
  logger: FastifyBaseLogger;
  next: LifecycleGatedRouteEvaluationHandler;
}): RouteEvaluationHandler {
  const diagnosticsLogger = input.logger.child({ service: 'lifecycleExecutionGate' });

  return async (evaluation) => {
    const lifecycleGate = classifyLifecycle(evaluation.event);
    const executableMatchCount = getExecutableMatchCount(evaluation.matches);

    diagnosticsLogger.info(
      {
        source: evaluation.event.source,
        ingressType: evaluation.event.ingressType,
        lifecycle: evaluation.event.lifecycle ?? null,
        rawItemEndDetected: lifecycleGate.rawItemEndDetected,
        lifecycleIntent: lifecycleGate.lifecycleIntent,
        triggerAllowed: lifecycleGate.triggerAllowed,
        restoreAllowed: lifecycleGate.restoreAllowed,
        skipReason: lifecycleGate.skipReason,
        matchedRouteCount: evaluation.matchedRouteCount,
        executableMatchCount
      },
      lifecycleGate.restoreAllowed
        ? 'Lifecycle gate classified event as restore-capable.'
        : 'Lifecycle gate classified event.'
    );

    if (!lifecycleGate.triggerAllowed) {
      logSkippedExecutableMatches(diagnosticsLogger, evaluation.matches, lifecycleGate.skipReason);
      return;
    }

    await input.next({
      ...evaluation,
      lifecycleGate
    });
  };
}
