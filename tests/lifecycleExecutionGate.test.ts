import assert from 'node:assert/strict';
import test from 'node:test';
import { registerExecutionPlannerSubscriber } from '../src/services/execution/executionPlannerSubscriber.js';
import { classifyLifecycle, registerLifecycleExecutionGate } from '../src/services/execution/lifecycleExecutionGate.js';
import { TargetExecutor } from '../src/services/execution/targetExecutor.js';
import { NormalizedIngressEvent } from '../src/services/ingress/normalizedEvent.js';
import { RouteEvaluationResult } from '../src/services/ingress/routeEvaluatorSubscriber.js';
import { TimerService } from '../src/services/timers/timerService.js';

function createEvent(overrides: Partial<NormalizedIngressEvent> = {}): NormalizedIngressEvent {
  return {
    source: 'protect_api',
    ingressType: 'api',
    timestamp: '2026-04-27T00:00:00.000Z',
    eventId: null,
    eventType: 'smartDetectZone',
    eventClass: 'zone',
    cameraId: 'camera-1',
    objectTypes: ['person'],
    userId: null,
    userName: null,
    doorId: null,
    doorName: null,
    credentialProvider: null,
    result: null,
    raw: { item: { device: 'camera-1', type: 'smartDetectZone' } },
    diagnosticsOnly: true,
    resolvedSource: {
      sourceType: 'protect_source',
      sourceId: 1,
      protectCameraId: 'camera-1',
      name: 'Driveway',
      modelKey: 'camera',
      state: 'CONNECTED',
      lastSeenAt: '2026-04-27T00:00:00.000Z',
      lastEventSeenAt: null
    },
    lifecycle: 'add',
    ...overrides
  };
}

function createEvaluation(event: NormalizedIngressEvent): RouteEvaluationResult {
  return {
    event,
    evaluatedRouteCount: 1,
    matchedRouteCount: 1,
    matches: [{
      routeId: 10,
      bindingStatus: 'resolved',
      enabled: true,
      isExecutable: true,
      targetType: 'floodlight',
      targetId: 20
    }],
    nonMatchSummary: {
      missing_resolved_source: 0,
      source_mismatch: 0,
      event_class_mismatch: 0,
      upstream_event_type_mismatch: 0,
      object_type_mismatch: 0
    }
  };
}

const logger = {
  child: () => logger,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as never;

test('Protect API add is trigger-capable', () => {
  const decision = classifyLifecycle(createEvent({ lifecycle: 'add' }));
  assert.equal(decision.triggerAllowed, true);
  assert.equal(decision.restoreAllowed, false);
  assert.equal(decision.lifecycleIntent, 'trigger');
  assert.equal(decision.skipReason, null);
});

test('Protect API update without item.end is diagnostics-only', () => {
  const decision = classifyLifecycle(createEvent({ lifecycle: 'update' }));
  assert.equal(decision.triggerAllowed, false);
  assert.equal(decision.restoreAllowed, false);
  assert.equal(decision.lifecycleIntent, 'diagnostics_only');
  assert.equal(decision.skipReason, 'lifecycle_update_non_trigger');
});

test('Protect API update with item.end is restore-capable but not trigger-capable', () => {
  const decision = classifyLifecycle(createEvent({
    lifecycle: 'update',
    raw: { item: { device: 'camera-1', type: 'smartDetectZone', end: 1770000000000 } }
  }));
  assert.equal(decision.triggerAllowed, false);
  assert.equal(decision.restoreAllowed, true);
  assert.equal(decision.lifecycleIntent, 'restore');
  assert.equal(decision.skipReason, 'lifecycle_update_with_end_restore_only');
});

test('lifecycle gate forwards skipped events to the execution planner', async () => {
  const forwarded: Array<{ lifecycleGate: { triggerAllowed: boolean; skipReason: string | null } }> = [];
  const gate = registerLifecycleExecutionGate({
    logger,
    next: (result) => {
      forwarded.push(result);
    }
  });

  await gate(createEvaluation(createEvent({ lifecycle: 'update' })));
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].lifecycleGate.triggerAllowed, false);
  assert.equal(forwarded[0].lifecycleGate.skipReason, 'lifecycle_update_non_trigger');
});

test('Protect API add reaches executor exactly once through gate and planner', async () => {
  const executions: unknown[] = [];
  const executor: TargetExecutor = {
    targetType: 'floodlight',
    async execute(context) {
      executions.push(context);
      return {
        accepted: true,
        reason: 'accepted',
        activatedTargets: [context.targetId],
        skippedTargets: []
      };
    }
  };
  const planner = registerExecutionPlannerSubscriber({
    logger,
    timerService: new TimerService(),
    executors: [executor]
  });
  const gate = registerLifecycleExecutionGate({ logger, next: planner });

  await gate(createEvaluation(createEvent({ lifecycle: 'add' })));
  assert.equal(executions.length, 1);
});

test('Protect API update reaches planner but does not reach executor', async () => {
  const executions: unknown[] = [];
  const executor: TargetExecutor = {
    targetType: 'floodlight',
    async execute(context) {
      executions.push(context);
      return {
        accepted: true,
        reason: 'accepted',
        activatedTargets: [context.targetId],
        skippedTargets: []
      };
    }
  };
  const planner = registerExecutionPlannerSubscriber({
    logger,
    timerService: new TimerService(),
    executors: [executor]
  });
  const gate = registerLifecycleExecutionGate({ logger, next: planner });

  await gate(createEvaluation(createEvent({ lifecycle: 'update' })));
  assert.equal(executions.length, 0);
});
