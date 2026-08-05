import assert from 'node:assert/strict';
import test from 'node:test';
import net, { Socket } from 'node:net';
import { ConsumerAction } from '../src/services/execution/virtualSecurityPanelDiagnosticsConsumer.js';
import { createVirtualSecurityPanelAdapter } from '../src/services/execution/virtualSecurityPanelAdapter.js';
import { SavantVirtualSecurityPanelConsumer } from '../src/services/virtualSecurityPanel/virtualSecurityPanelConsumer.js';
import { initializeVirtualSecurityPanelRuntime } from '../src/services/execution/virtualSecurityPanelRuntime.js';
import {
  SetVirtualSecurityStateRequest,
  SetVirtualSecurityStateResult,
  VirtualSecurityPanelConsumer,
  VirtualSecurityPanelStatus
} from '../src/services/virtualSecurityPanel/types.js';
import {
  SavantTcpTransportConnectionHandlers,
  VirtualSecurityPanelTransport
} from '../src/services/virtualSecurityPanel/savantTcpTransport.js';

function action(overrides: Partial<ConsumerAction> = {}): ConsumerAction {
  return {
    traceId: 'trace-1', routeId: 9, bindingId: 12, consumerType: 'virtual_security_panel',
    semanticCondition: { id: 7, semanticKey: 'protect.frontyard.person', label: 'Front Yard' },
    binding: { panelKey: 'default', zoneNumber: 4 }, desiredState: 'active', lifecycleIntent: 'trigger',
    sourceEvent: { source: 'protect_api', ingressType: 'api', eventId: 'event-1', eventType: 'smartDetectZone', eventClass: 'zone', timestamp: '2026-01-01T00:00:00Z' },
    ...overrides
  };
}

class CapturingConsumer implements VirtualSecurityPanelConsumer {
  requests: SetVirtualSecurityStateRequest[] = [];
  result: SetVirtualSecurityStateResult = { accepted: true, changed: true, delivered: true, retained: true, reason: 'state_changed_and_sent' };
  async start() {}
  async stop() {}
  async setDesiredState(request: SetVirtualSecurityStateRequest) { this.requests.push(request); return this.result; }
  getStatus(): VirtualSecurityPanelStatus { return { lifecycle: 'stopped', connected: false, retainedStates: [] }; }
}

class CountingTransport implements VirtualSecurityPanelTransport {
  connected = true;
  sends: Buffer[] = [];
  handlers?: SavantTcpTransportConnectionHandlers;
  setConnectionHandlers(handlers: SavantTcpTransportConnectionHandlers) { this.handlers = handlers; }
  getStatus() { return { lifecycle: this.connected ? 'connected' as const : 'listening' as const, connected: this.connected }; }
  async start() {}
  async stop() {}
  async send(frame: Buffer) { this.sends.push(Buffer.from(frame)); return { connectionId: 1 }; }
  markUnhealthy() { this.connected = false; }
}

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

test('adapter validates, maps states, passes context, and preserves consumer results without retry', async () => {
  const consumer = new CapturingConsumer();
  const adapter = createVirtualSecurityPanelAdapter(consumer);
  const active = await adapter(action());
  assert.equal(active.mappedConsumerState, 'Violated');
  assert.equal(active.reason, 'state_changed_and_sent');
  assert.equal(consumer.requests[0].desiredState, 'Violated');
  assert.deepEqual(consumer.requests[0].executionContext?.sourceEvent, action().sourceEvent);
  assert.equal(consumer.requests[0].executionContext?.bindingId, 12);

  consumer.result = { accepted: true, changed: true, delivered: false, retained: true, reason: 'state_changed_retained_disconnected' };
  const inactive = await adapter(action({ desiredState: 'inactive', lifecycleIntent: 'restore' }));
  assert.equal(inactive.mappedConsumerState, 'Normal');
  assert.equal(inactive.delivered, false);
  assert.equal(consumer.requests.length, 2);

  consumer.result = { accepted: true, changed: false, delivered: false, retained: true, reason: 'state_unchanged' };
  assert.equal((await adapter(action())).reason, 'state_unchanged');
  consumer.result = { accepted: true, changed: true, delivered: false, retained: true, reason: 'transport_send_failed' };
  const failed = await adapter(action());
  assert.equal(failed.reason, 'transport_send_failed');
  assert.equal(failed.delivered, false);
  assert.equal(failed.retained, true);

  for (const invalid of [
    action({ binding: { panelKey: 'other' as 'default', zoneNumber: 4 } }),
    action({ binding: { panelKey: 'default', zoneNumber: 0 } }),
    action({ binding: { panelKey: 'default', zoneNumber: 209 } }),
    action({ binding: { panelKey: 'default', zoneNumber: 1.5 } }),
    action({ desiredState: 'bad' as 'active' })
  ]) assert.equal((await adapter(invalid)).accepted, false);
  assert.equal(consumer.requests.length, 4);
});

test('duplicate active and inactive suppression remains owned by the real consumer', async () => {
  const transport = new CountingTransport();
  const consumer = new SavantVirtualSecurityPanelConsumer({ logger, transport });
  const adapter = createVirtualSecurityPanelAdapter(consumer);
  assert.equal((await adapter(action())).reason, 'state_changed_and_sent');
  assert.equal((await adapter(action())).reason, 'state_unchanged');
  assert.equal(transport.sends.length, 1);
  const restore = action({ desiredState: 'inactive', lifecycleIntent: 'restore' });
  assert.equal((await adapter(restore)).reason, 'state_changed_and_sent');
  assert.equal((await adapter(restore)).reason, 'state_unchanged');
  assert.equal(transport.sends.length, 2);
});

test('disconnected adapter actions retain active and inactive honestly', async () => {
  const transport = new CountingTransport();
  transport.connected = false;
  const adapter = createVirtualSecurityPanelAdapter(new SavantVirtualSecurityPanelConsumer({ logger, transport }));
  const active = await adapter(action());
  const inactive = await adapter(action({ desiredState: 'inactive', lifecycleIntent: 'restore' }));
  assert.equal(active.reason, 'state_changed_retained_disconnected');
  assert.equal(inactive.reason, 'state_changed_retained_disconnected');
  assert.equal(active.delivered, false);
  assert.equal(inactive.delivered, false);
  assert.equal(transport.sends.length, 0);
});

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readBytes(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve) => {
    let bytes = Buffer.alloc(0);
    socket.on('data', function onData(chunk) {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length >= count) { socket.off('data', onData); resolve(bytes); }
    });
  });
}

test('startup seeds distinct configured zones before listener and registers after start', async () => {
  const events: string[] = [];
  const consumer = new CapturingConsumer();
  consumer.setDesiredState = async (request) => { events.push(`seed:${request.consumerBinding.zoneNumber}:${request.desiredState}`); consumer.requests.push(request); return consumer.result; };
  consumer.start = async () => { events.push('start'); };
  const zones = await initializeVirtualSecurityPanelRuntime({
    consumer,
    configuredZoneNumbers: [37, 4, 37, 128],
    registerAdapter: () => { events.push('register'); }
  });
  assert.deepEqual(zones, [4, 37, 128]);
  assert.deepEqual(events, ['seed:4:Normal', 'seed:37:Normal', 'seed:128:Normal', 'start', 'register']);
  assert.equal(events.some((event) => event.startsWith('seed:1:')), false);
});

test('initial and reconnect snapshots contain every configured Normal zone in ascending order', async () => {
  const consumer = new SavantVirtualSecurityPanelConsumer({ host: '127.0.0.1', port: 0, logger });
  await initializeVirtualSecurityPanelRuntime({ consumer, configuredZoneNumbers: [128, 4, 37, 4], registerAdapter: () => undefined });
  const address = consumer.getStatus().listeningAddress;
  assert.ok(address);
  const port = Number(address.slice(address.lastIndexOf(':') + 1));
  const expected = '0AZC004100CD\r\n0AZC037100C7\r\n0AZC128100C6\r\n';
  const first = await connect(port);
  assert.equal((await readBytes(first, 42)).toString('ascii'), expected);
  first.destroy();
  const second = await connect(port);
  assert.equal((await readBytes(second, 42)).toString('ascii'), expected);
  second.destroy();
  await consumer.stop();
});
