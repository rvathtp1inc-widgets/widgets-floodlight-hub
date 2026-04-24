import { asc } from 'drizzle-orm';
import { FastifyBaseLogger } from 'fastify';
import { db } from '../../db/client.js';
import { eventRoutes } from '../../db/schema.js';
import { IngressEventDispatcher } from './ingressEventDispatcher.js';
import { NormalizedIngressEvent } from './normalizedEvent.js';

type EventRouteRow = typeof eventRoutes.$inferSelect;

type NonMatchReason =
  | 'missing_resolved_source'
  | 'source_mismatch'
  | 'event_class_mismatch'
  | 'upstream_event_type_mismatch'
  | 'object_type_mismatch';

type NonExecutableReason = 'unresolved' | 'disabled';

type RouteEvaluationMatch = {
  routeId: number;
  bindingStatus: string;
  enabled: boolean;
  isExecutable: boolean;
  targetType: string | null;
  targetId: number | null;
  nonExecutableReason?: NonExecutableReason;
};

const NON_MATCH_REASONS: NonMatchReason[] = [
  'missing_resolved_source',
  'source_mismatch',
  'event_class_mismatch',
  'upstream_event_type_mismatch',
  'object_type_mismatch'
];

function buildEmptyNonMatchSummary(): Record<NonMatchReason, number> {
  return NON_MATCH_REASONS.reduce(
    (summary, reason) => {
      summary[reason] = 0;
      return summary;
    },
    {} as Record<NonMatchReason, number>
  );
}

function parseObjectTypes(value: string | null): string[] | null {
  if (value === null) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0);
  } catch {
    return [];
  }
}

function hasObjectTypeMatch(routeObjectTypes: string[] | null, eventObjectTypes: string[] | undefined): boolean {
  if (routeObjectTypes === null) {
    return true;
  }

  if (!eventObjectTypes || eventObjectTypes.length === 0) {
    return false;
  }

  const eventObjectTypeSet = new Set(eventObjectTypes);
  return routeObjectTypes.some((objectType) => eventObjectTypeSet.has(objectType));
}

function getNonExecutableReason(route: EventRouteRow): NonExecutableReason | undefined {
  if (route.bindingStatus !== 'resolved') {
    return 'unresolved';
  }

  if (route.enabled !== true) {
    return 'disabled';
  }

  return undefined;
}

function evaluateRoute(route: EventRouteRow, event: NormalizedIngressEvent): RouteEvaluationMatch | NonMatchReason {
  if (!event.resolvedSource) {
    return 'missing_resolved_source';
  }

  if (route.sourceType !== event.resolvedSource.sourceType || route.sourceId !== event.resolvedSource.sourceId) {
    return 'source_mismatch';
  }

  if (route.eventClass !== event.eventClass) {
    return 'event_class_mismatch';
  }

  if (route.upstreamEventType !== null && route.upstreamEventType !== event.eventType) {
    return 'upstream_event_type_mismatch';
  }

  const routeObjectTypes = parseObjectTypes(route.objectTypesJson);
  if (!hasObjectTypeMatch(routeObjectTypes, event.objectTypes)) {
    return 'object_type_mismatch';
  }

  const nonExecutableReason = getNonExecutableReason(route);

  return {
    routeId: route.id,
    bindingStatus: route.bindingStatus,
    enabled: route.enabled,
    isExecutable: nonExecutableReason === undefined,
    targetType: route.targetType,
    targetId: route.targetId,
    ...(nonExecutableReason ? { nonExecutableReason } : {})
  };
}

function buildResolvedSourceDiagnostics(event: NormalizedIngressEvent) {
  if (!event.resolvedSource) {
    return null;
  }

  return {
    sourceType: event.resolvedSource.sourceType,
    sourceId: event.resolvedSource.sourceId,
    protectCameraId: 'protectCameraId' in event.resolvedSource ? event.resolvedSource.protectCameraId : null
  };
}

export function registerRouteEvaluatorSubscriber(
  dispatcher: IngressEventDispatcher,
  logger: FastifyBaseLogger
): () => void {
  const diagnosticsLogger = logger.child({ service: 'routeEvaluator' });

  return dispatcher.subscribe(async (event) => {
    // The current event_routes schema is source_type/source_id based. That is
    // sufficient for Protect source routes but intentionally limited for Access:
    // useful future Access routing dimensions include doorId, userId,
    // credentialProvider, and result. This subscriber only evaluates the current
    // persisted schema and does not redesign routing.
    const routes = await db.select().from(eventRoutes).orderBy(asc(eventRoutes.id));
    const matches: RouteEvaluationMatch[] = [];
    const nonMatchSummary = buildEmptyNonMatchSummary();

    for (const route of routes) {
      const result = evaluateRoute(route, event);
      if (typeof result === 'string') {
        nonMatchSummary[result] += 1;
        continue;
      }

      matches.push(result);
    }

    diagnosticsLogger.info(
      {
        source: event.source,
        ingressType: event.ingressType,
        eventId: event.eventId,
        eventType: event.eventType,
        eventClass: event.eventClass,
        resolvedSource: buildResolvedSourceDiagnostics(event),
        evaluatedRouteCount: routes.length,
        matchedRouteCount: matches.length,
        matches,
        nonMatchSummary
      },
      'Route evaluation diagnostics completed.'
    );
  });
}
