import { TimerService } from '../timers/timerService.js';
import { NormalizedIngressEvent } from '../ingress/normalizedEvent.js';

export type SupportedExecutionTargetType = 'floodlight' | 'group';

export interface SkippedTarget {
  floodlightId: number;
  reason: string;
}

export interface TargetExecutionResult {
  accepted: boolean;
  reason: string;
  activatedTargets: number[];
  skippedTargets: SkippedTarget[];
}

export interface TargetExecutionContext {
  routeId: number;
  event: NormalizedIngressEvent;
  targetType: SupportedExecutionTargetType;
  targetId: number;
  timerService: TimerService;
}

export interface TargetExecutor {
  readonly targetType: SupportedExecutionTargetType;
  execute(context: TargetExecutionContext): Promise<TargetExecutionResult>;
}
