import { executeGroupActivation } from './floodlightActivationService.js';
import { TargetExecutionContext, TargetExecutionResult, TargetExecutor } from './targetExecutor.js';

export class GroupExecutor implements TargetExecutor {
  readonly targetType = 'group' as const;

  execute(context: TargetExecutionContext): Promise<TargetExecutionResult> {
    return executeGroupActivation({
      routeId: context.routeId,
      event: context.event,
      groupId: context.targetId,
      timerService: context.timerService
    });
  }
}
