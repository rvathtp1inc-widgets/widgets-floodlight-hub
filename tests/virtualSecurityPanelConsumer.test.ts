import assert from 'node:assert/strict';
import net, { Socket } from 'node:net';
import test from 'node:test';
import {
  SavantTcpTransportConnectionHandlers,
  VirtualSecurityPanelTransport
} from '../src/services/virtualSecurityPanel/savantTcpTransport.js';
import { SavantVirtualSecurityPanelConsumer } from '../src/services/virtualSecurityPanel/virtualSecurityPanelConsumer.js';
import { VirtualSecurityPanelLifecycle } from '../src/services/virtualSecurityPanel/types.js';

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
};

class ControlledTransport implements VirtualSecurityPanelTransport {
  handlers?: SavantTcpTransportConnectionHandlers;
  lifecycle: VirtualSecurityPanelLifecycle = 'stopped';
  connected = false;
  sent: Buffer[] = [];
  failNext = false;
  setConnectionHandlers(handlers: SavantTcpTransportConnectionHandlers): void { this.handlers = handlers; }
  getStatus() { return { lifecycle: this.lifecycle, connected: this.connected, lastClientConnectedAt: null, lastClientDisconnectedAt: null, lastTransportError: null }; }
  async start() { this.lifecycle = 'listening'; }
  async stop() { this.connected = false; this.lifecycle = 'stopped'; }
  async send(frame: Buffer) {
    if (this.failNext) { this.failNext = false; throw new Error('controlled failure'); }
    this.sent.push(Buffer.from(frame));
    return { connectionId: 1 };
  }
  markUnhealthy() { this.connected = false; this.lifecycle = 'listening'; }
  connect(id = 1) { this.connected = true; this.lifecycle = 'connected'; this.handlers?.connected(id); }
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readBytes(socket: Socket, count: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for bytes')), 1_000);
    socket.on('data', function onData(chunk) {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.length >= count) {
        clearTimeout(timeout);
        socket.off('data', onData);
        resolve(bytes);
      }
    });
  });
}

function waitForClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

test('consumer begins empty, validates input, and independently retains disconnected state', async () => {
  const transport = new ControlledTransport();
  const consumer = new SavantVirtualSecurityPanelConsumer({ logger, transport, now: () => '2026-01-01T00:00:00.000Z' });
  assert.deepEqual(consumer.getStatus().retainedStates, []);
  assert.equal((await consumer.setDesiredState({ consumerBinding: { zoneNumber: 0 }, desiredState: 'Normal' })).reason, 'invalid_binding');
  assert.equal((await consumer.setDesiredState({ consumerBinding: { zoneNumber: 1 }, desiredState: 'Bad' as never })).reason, 'invalid_state');
  assert.deepEqual(consumer.getStatus().retainedStates, []);

  assert.equal((await consumer.setDesiredState({ consumerBinding: { zoneNumber: 37 }, desiredState: 'Violated' })).reason, 'state_changed_retained_disconnected');
  assert.equal((await consumer.setDesiredState({ consumerBinding: { zoneNumber: 1 }, desiredState: 'Normal' })).reason, 'state_changed_retained_disconnected');
  assert.equal((await consumer.setDesiredState({ consumerBinding: { zoneNumber: 37 }, desiredState: 'Violated' })).reason, 'state_unchanged');
  assert.deepEqual(consumer.getStatus().retainedStates.map((state) => [state.zoneNumber, state.currentState, state.deliveryStatus]), [
    [1, 'Normal', 'pending_reconnect'],
    [37, 'Violated', 'pending_reconnect']
  ]);
});

test('failed operation does not poison queue and reconnect resends every retained state', async () => {
  const transport = new ControlledTransport();
  const consumer = new SavantVirtualSecurityPanelConsumer({ logger, transport });
  await consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Normal' });
  await consumer.setDesiredState({ consumerBinding: { zoneNumber: 37 }, desiredState: 'Violated' });
  transport.connect();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(transport.sent.map((frame) => frame.toString('ascii')), ['0AZC004100CD\r\n', '0AZC037900BF\r\n']);

  transport.failNext = true;
  const failed = await consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Violated' });
  assert.equal(failed.reason, 'transport_send_failed');
  const retained = await consumer.setDesiredState({ consumerBinding: { zoneNumber: 12 }, desiredState: 'Normal' });
  assert.equal(retained.reason, 'state_changed_retained_disconnected');

  transport.connect(2);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(transport.sent.slice(-3).map((frame) => frame.toString('ascii')), [
    '0AZC004900C5\r\n',
    '0AZC012100CE\r\n',
    '0AZC037900BF\r\n'
  ]);
});

test('state change queued during reconnect is the final emitted state for its zone', async () => {
  const transport = new ControlledTransport();
  const consumer = new SavantVirtualSecurityPanelConsumer({ logger, transport });
  await consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Normal' });
  transport.connect();
  const changed = consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Violated' });
  assert.equal((await changed).reason, 'state_changed_and_sent');
  assert.deepEqual(transport.sent.map((frame) => frame.toString('ascii')), [
    '0AZC004100CD\r\n',
    '0AZC004900C5\r\n'
  ]);
});

test('real TCP lifecycle is idempotent and reconnect synchronizes retained zones in order', async () => {
  const consumer = new SavantVirtualSecurityPanelConsumer({ host: '127.0.0.1', port: 0, logger });
  await Promise.all([consumer.start(), consumer.start()]);
  const address = consumer.getStatus().listeningAddress;
  assert.ok(address);
  const port = Number(address.slice(address.lastIndexOf(':') + 1));
  await consumer.setDesiredState({ consumerBinding: { zoneNumber: 37 }, desiredState: 'Violated' });
  await consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Normal' });

  const first = await connect(port);
  assert.equal((await readBytes(first, 28)).toString('ascii'), '0AZC004100CD\r\n0AZC037900BF\r\n');
  assert.equal(first.destroyed, false);
  first.destroy();
  await waitForClose(first);

  const second = await connect(port);
  assert.equal((await readBytes(second, 28)).toString('ascii'), '0AZC004100CD\r\n0AZC037900BF\r\n');
  assert.match(consumer.getStatus().lastClientConnectedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.match(consumer.getStatus().lastClientDisconnectedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  await Promise.all([consumer.stop(), consumer.stop()]);
  await waitForClose(second);
  assert.equal(second.destroyed, true);
  assert.equal(consumer.getStatus().lifecycle, 'stopped');
});
