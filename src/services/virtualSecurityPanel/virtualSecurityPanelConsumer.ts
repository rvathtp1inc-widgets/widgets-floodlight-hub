import { buildElkZoneChangeFrame } from './buildElkZoneChangeFrame.js';
import { SavantTcpTransport, VirtualSecurityPanelTransport } from './savantTcpTransport.js';
import {
  MAX_VIRTUAL_SECURITY_ZONE,
  MIN_VIRTUAL_SECURITY_ZONE,
  RetainedVirtualSecurityZoneState,
  SetVirtualSecurityStateRequest,
  SetVirtualSecurityStateResult,
  VirtualSecurityDesiredState,
  VirtualSecurityPanelConsumer,
  VirtualSecurityPanelLogger,
  VirtualSecurityPanelStatus
} from './types.js';

export interface VirtualSecurityPanelConsumerOptions {
  host?: string;
  port?: number;
  logger: VirtualSecurityPanelLogger;
  transport?: VirtualSecurityPanelTransport;
  now?: () => string;
}

export class SavantVirtualSecurityPanelConsumer implements VirtualSecurityPanelConsumer {
  private readonly retainedStates = new Map<number, RetainedVirtualSecurityZoneState>();
  private readonly transport: VirtualSecurityPanelTransport;
  private readonly logger: VirtualSecurityPanelLogger;
  private readonly now: () => string;
  private operationChain: Promise<void> = Promise.resolve();

  constructor(options: VirtualSecurityPanelConsumerOptions) {
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date().toISOString());
    this.transport = options.transport ?? new SavantTcpTransport(options);
    this.transport.setConnectionHandlers({
      connected: (connectionId) => { void this.enqueue(() => this.resynchronize(connectionId)); },
      disconnected: () => undefined
    });
  }

  start(): Promise<void> { return this.transport.start(); }
  stop(): Promise<void> { return this.transport.stop(); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationChain.catch(() => undefined).then(operation);
    this.operationChain = result.then(() => undefined, () => undefined);
    return result;
  }

  async setDesiredState(request: SetVirtualSecurityStateRequest): Promise<SetVirtualSecurityStateResult> {
    const zoneNumber = request?.consumerBinding?.zoneNumber;
    if (!Number.isInteger(zoneNumber) || zoneNumber < MIN_VIRTUAL_SECURITY_ZONE || zoneNumber > MAX_VIRTUAL_SECURITY_ZONE) {
      this.logger.warn({ zoneNumber, ...request?.executionContext }, 'Invalid virtual security consumer binding.');
      return { accepted: false, changed: false, delivered: false, retained: false, reason: 'invalid_binding' };
    }
    const desiredState = request?.desiredState;
    if (desiredState !== 'Normal' && desiredState !== 'Violated') {
      this.logger.warn({ zoneNumber, desiredState, ...request?.executionContext }, 'Invalid virtual security desired state.');
      return { accepted: false, changed: false, delivered: false, retained: false, reason: 'invalid_state' };
    }
    return this.enqueue(() => this.applyState(zoneNumber, desiredState, request));
  }

  private async applyState(
    zoneNumber: number,
    desiredState: VirtualSecurityDesiredState,
    request: SetVirtualSecurityStateRequest
  ): Promise<SetVirtualSecurityStateResult> {
    const previous = this.retainedStates.get(zoneNumber);
    if (previous?.currentState === desiredState) {
      return { accepted: true, changed: false, delivered: false, retained: true, reason: 'state_unchanged', zoneNumber, desiredState };
    }
    const connected = this.transport.getStatus().connected;
    const retained: RetainedVirtualSecurityZoneState = {
      zoneNumber,
      currentState: desiredState,
      lastChangedAt: this.now(),
      deliveryStatus: connected ? 'never_sent' : 'pending_reconnect'
    };
    this.retainedStates.set(zoneNumber, retained);
    if (!connected) {
      this.logger.warn({ zoneNumber, previousState: previous?.currentState, desiredState, ...request.executionContext }, 'Disconnected state retained.');
      return { accepted: true, changed: true, delivered: false, retained: true, reason: 'state_changed_retained_disconnected', zoneNumber, desiredState };
    }
    try {
      const frame = buildElkZoneChangeFrame(zoneNumber, desiredState);
      const { connectionId } = await this.transport.send(frame);
      retained.deliveryStatus = 'sent';
      retained.lastDeliveryAt = this.now();
      this.logFrame(frame, zoneNumber, desiredState, connectionId, 'state change', request);
      return { accepted: true, changed: true, delivered: true, retained: true, reason: 'state_changed_and_sent', zoneNumber, desiredState };
    } catch (error) {
      retained.deliveryStatus = 'send_failed';
      this.transport.markUnhealthy();
      this.logger.error({ zoneNumber, desiredState, err: error, ...request.executionContext }, 'Virtual security transport send failed.');
      return { accepted: true, changed: true, delivered: false, retained: true, reason: 'transport_send_failed', zoneNumber, desiredState };
    }
  }

  private async resynchronize(connectionId: number): Promise<void> {
    this.logger.info({ connectionId }, 'Reconnect resynchronization started.');
    for (const zoneNumber of [...this.retainedStates.keys()].sort((left, right) => left - right)) {
      const retained = this.retainedStates.get(zoneNumber);
      if (!retained) continue;
      const state = retained.currentState;
      const frame = buildElkZoneChangeFrame(zoneNumber, state);
      try {
        await this.transport.send(frame);
        retained.deliveryStatus = 'sent';
        retained.lastDeliveryAt = this.now();
        this.logFrame(frame, zoneNumber, state, connectionId, 'reconnect synchronization');
      } catch (error) {
        retained.deliveryStatus = 'send_failed';
        this.transport.markUnhealthy();
        this.logger.error({ connectionId, zoneNumber, desiredState: state, err: error }, 'Reconnect resynchronization failed.');
        return;
      }
    }
    this.logger.info({ connectionId }, 'Reconnect resynchronization completed.');
  }

  private logFrame(
    frame: Buffer,
    zoneNumber: number,
    desiredState: VirtualSecurityDesiredState,
    connectionId: number,
    deliveryReason: string,
    request?: SetVirtualSecurityStateRequest
  ): void {
    this.logger.debug({
      zoneNumber,
      desiredState,
      connectionId,
      deliveryReason,
      escapedFrame: frame.toString('ascii').replace('\r', '\\r').replace('\n', '\\n'),
      hexadecimalFrameBytes: frame.toString('hex').match(/../g)?.join(' ') ?? '',
      ...request?.executionContext
    }, 'ELK Zone Change frame sent.');
  }

  getStatus(): VirtualSecurityPanelStatus {
    const transportStatus = this.transport.getStatus();
    return {
      ...transportStatus,
      retainedStates: [...this.retainedStates.values()]
        .sort((left, right) => left.zoneNumber - right.zoneNumber)
        .map((entry) => ({ ...entry }))
    };
  }
}
