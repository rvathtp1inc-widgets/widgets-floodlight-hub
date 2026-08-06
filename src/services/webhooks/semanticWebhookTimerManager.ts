export class SemanticWebhookTimerManager {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onExpire: (semanticWebhookId: number) => Promise<void>,
    private readonly clock: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis
  ) {}

  scheduleOrReset(semanticWebhookId: number, seconds: number) {
    this.cancel(semanticWebhookId);
    const timer = this.clock.setTimeout(() => {
      if (this.timers.get(semanticWebhookId) !== timer) return;
      this.timers.delete(semanticWebhookId);
      void this.onExpire(semanticWebhookId);
    }, seconds * 1000);
    this.timers.set(semanticWebhookId, timer);
  }

  cancel(semanticWebhookId: number) {
    const timer = this.timers.get(semanticWebhookId);
    if (timer) this.clock.clearTimeout(timer);
    this.timers.delete(semanticWebhookId);
  }

  has(semanticWebhookId: number) {
    return this.timers.has(semanticWebhookId);
  }

  stopAll() {
    for (const timer of this.timers.values()) this.clock.clearTimeout(timer);
    this.timers.clear();
  }
}
