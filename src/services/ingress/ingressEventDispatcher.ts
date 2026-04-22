import { NormalizedIngressEvent } from './normalizedEvent.js';

export type IngressEventHandler = (event: NormalizedIngressEvent) => void | Promise<void>;

export class IngressEventDispatcher {
  private readonly handlers = new Set<IngressEventHandler>();

  subscribe(handler: IngressEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async publish(event: NormalizedIngressEvent): Promise<void> {
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
