import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import net, { Socket } from 'node:net';
import test from 'node:test';
import {
  SavantSocketFrameWriter,
  SavantTcpTransport,
  SavantWritableSocket,
  writeSavantSocketFrame
} from '../src/services/virtualSecurityPanel/savantTcpTransport.js';
import { SavantVirtualSecurityPanelConsumer } from '../src/services/virtualSecurityPanel/virtualSecurityPanelConsumer.js';

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

class ControlledSocket extends EventEmitter implements SavantWritableSocket {
  destroyed = false;
  writeReturn = true;
  callback?: (error?: Error | null) => void;
  writes: Uint8Array[] = [];

  write(frame: Uint8Array, callback: (error?: Error | null) => void): boolean {
    this.writes.push(frame);
    this.callback = callback;
    return this.writeReturn;
  }
}

interface ControlledWrite {
  frame: Buffer;
  resolve(): void;
  reject(error: Error): void;
}

function controlledWriter(): { writer: SavantSocketFrameWriter; writes: ControlledWrite[] } {
  const writes: ControlledWrite[] = [];
  return {
    writes,
    writer: (_socket, frame) => new Promise<void>((resolve, reject) => {
      writes.push({ frame: Buffer.from(frame), resolve, reject });
    })
  };
}

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function waitForClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

async function waitForCondition(condition: () => boolean, remainingTurns = 20): Promise<void> {
  if (condition()) return;
  if (remainingTurns === 0) throw new Error('Condition was not reached within scheduled event-loop turns.');
  await new Promise<void>((resolve) => setImmediate(resolve));
  return waitForCondition(condition, remainingTurns - 1);
}

test('write completion waits for callback success', async () => {
  const socket = new ControlledSocket();
  let resolved = false;
  const send = writeSavantSocketFrame(socket, Buffer.from('frame')).then(() => { resolved = true; });
  await Promise.resolve();
  assert.equal(resolved, false);
  socket.callback?.();
  await send;
  assert.equal(resolved, true);
});

test('write callback error deterministically rejects', async () => {
  const socket = new ControlledSocket();
  const send = writeSavantSocketFrame(socket, Buffer.from('frame'));
  socket.callback?.(new Error('callback failed'));
  await assert.rejects(send, /callback failed/);
});

test('backpressure requires both callback completion and drain', async () => {
  const socket = new ControlledSocket();
  socket.writeReturn = false;
  let backpressureObserved = false;
  let resolved = false;
  const send = writeSavantSocketFrame(socket, Buffer.from('frame'), () => { backpressureObserved = true; })
    .then(() => { resolved = true; });
  assert.equal(backpressureObserved, true);
  socket.callback?.();
  await Promise.resolve();
  assert.equal(resolved, false);
  socket.emit('drain');
  await send;
  assert.equal(resolved, true);
});

test('socket close and error during outstanding writes reject', async () => {
  const closedSocket = new ControlledSocket();
  const closedSend = writeSavantSocketFrame(closedSocket, Buffer.from('frame'));
  closedSocket.emit('close');
  await assert.rejects(closedSend, /closed during write/);

  const erroredSocket = new ControlledSocket();
  const erroredSend = writeSavantSocketFrame(erroredSocket, Buffer.from('frame'));
  erroredSocket.emit('error', new Error('socket failed'));
  await assert.rejects(erroredSend, /socket failed/);
});

test('transport serializes two writes until the prior controlled write completes', async () => {
  const controlled = controlledWriter();
  const transport = new SavantTcpTransport({ host: '127.0.0.1', port: 0, logger, frameWriter: controlled.writer });
  await transport.start();
  const listeningAddress = transport.getStatus().listeningAddress;
  assert.ok(listeningAddress);
  const client = await connect(Number(listeningAddress.slice(listeningAddress.lastIndexOf(':') + 1)));

  const first = transport.send(Buffer.from('first'));
  const second = transport.send(Buffer.from('second'));
  await waitForCondition(() => controlled.writes.length === 1);
  assert.deepEqual(controlled.writes.map((write) => write.frame.toString()), ['first']);
  controlled.writes[0].resolve();
  await first;
  await waitForCondition(() => controlled.writes.length === 2);
  assert.deepEqual(controlled.writes.map((write) => write.frame.toString()), ['first', 'second']);
  controlled.writes[1].resolve();
  await second;
  await transport.stop();
  await waitForClose(client);
});

test('forced write failure marks connection unhealthy while consumer retention and queue recover', async () => {
  const controlled = controlledWriter();
  const transport = new SavantTcpTransport({ host: '127.0.0.1', port: 0, logger, frameWriter: controlled.writer });
  const consumer = new SavantVirtualSecurityPanelConsumer({ logger, transport });
  await consumer.start();
  const listeningAddress = consumer.getStatus().listeningAddress;
  assert.ok(listeningAddress);
  const port = Number(listeningAddress.slice(listeningAddress.lastIndexOf(':') + 1));
  const firstClient = await connect(port);

  const failedChange = consumer.setDesiredState({ consumerBinding: { zoneNumber: 37 }, desiredState: 'Violated' });
  await waitForCondition(() => controlled.writes.length === 1);
  assert.equal(controlled.writes.length, 1);
  controlled.writes[0].reject(new Error('forced outstanding write failure'));
  assert.equal((await failedChange).reason, 'transport_send_failed');
  await waitForClose(firstClient);
  assert.equal(consumer.getStatus().connected, false);
  assert.equal(consumer.getStatus().retainedStates[0].currentState, 'Violated');
  assert.equal(consumer.getStatus().retainedStates[0].deliveryStatus, 'send_failed');

  const laterChange = await consumer.setDesiredState({ consumerBinding: { zoneNumber: 4 }, desiredState: 'Normal' });
  assert.equal(laterChange.reason, 'state_changed_retained_disconnected');

  const secondClient = await connect(port);
  await waitForCondition(() => controlled.writes.length === 2);
  assert.equal(controlled.writes[1].frame.toString('ascii'), '0AZC004100CD\r\n');
  controlled.writes[1].resolve();
  await waitForCondition(() => controlled.writes.length === 3);
  assert.equal(controlled.writes[2].frame.toString('ascii'), '0AZC037900BF\r\n');
  controlled.writes[2].resolve();
  await waitForCondition(() => consumer.getStatus().retainedStates.every((state) => state.deliveryStatus === 'sent'));
  assert.deepEqual(consumer.getStatus().retainedStates.map((state) => state.deliveryStatus), ['sent', 'sent']);
  await consumer.stop();
  await waitForClose(secondClient);
});
