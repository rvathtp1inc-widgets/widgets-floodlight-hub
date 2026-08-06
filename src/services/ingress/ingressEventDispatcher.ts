import { NormalizedIngressEvent } from './normalizedEvent.js';

export type IngressEventHandler = (event: NormalizedIngressEvent) => unknown | Promise<unknown>;

export class IngressEventDispatcher {
  private readonly handlers = new Set<IngressEventHandler>();

  subscribe(handler: IngressEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async publish(event: NormalizedIngressEvent): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const handler of this.handlers) {
      results.push(await handler(event));
    }
    return results;
  }
}
