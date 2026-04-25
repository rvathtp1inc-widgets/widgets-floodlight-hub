import { executeFloodlightActivation } from './floodlightActivationService.js';
import { TargetExecutionContext, TargetExecutionResult, TargetExecutor } from './targetExecutor.js';

export class FloodlightExecutor implements TargetExecutor {
  readonly targetType = 'floodlight' as const;

  execute(context: TargetExecutionContext): Promise<TargetExecutionResult> {
    return executeFloodlightActivation({
      routeId: context.routeId,
      event: context.event,
      floodlightId: context.targetId,
      timerService: context.timerService
    });
  }
}
