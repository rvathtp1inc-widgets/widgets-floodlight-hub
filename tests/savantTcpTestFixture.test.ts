import assert from 'node:assert/strict';
import net, { Socket } from 'node:net';
import test from 'node:test';
import {
  buildElkZoneChangeFrame
} from '../src/services/virtualSecurityPanel/buildElkZoneChangeFrame.js';
import type { VirtualSecurityDesiredState } from '../src/services/virtualSecurityPanel/types.js';
import {
  SAVANT_TCP_TEST_ZONES,
  SavantTcpTestFixtureServer
} from '../src/savantTcpTestFixtureServer.js';

const EXPECTED_FRAMES: Record<number, Record<VirtualSecurityDesiredState, string>> = {
  1: { Normal: '0AZC001100D0\r\n', Violated: '0AZC001900C8\r\n' },
  4: { Normal: '0AZC004100CD\r\n', Violated: '0AZC004900C5\r\n' },
  12: { Normal: '0AZC012100CE\r\n', Violated: '0AZC012900C6\r\n' },
  37: { Normal: '0AZC037100C7\r\n', Violated: '0AZC037900BF\r\n' },
  128: { Normal: '0AZC128100C6\r\n', Violated: '0AZC128900BE\r\n' }
};
const FRAME_LENGTH = 14;

function connect(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function readBytes(socket: Socket, byteCount: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for TCP bytes.')), 1_000);
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const combined = Buffer.concat(chunks);
      if (combined.length >= byteCount) {
        clearTimeout(timeout);
        socket.off('data', onData);
        resolve(combined);
      }
    };
    socket.on('data', onData);
  });
}

function waitForClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return Promise.resolve();
  return new Promise((resolve) => socket.once('close', () => resolve()));
}

test('ELK Zone Change generator matches every authoritative vector', () => {
  for (const zoneNumber of SAVANT_TCP_TEST_ZONES) {
    for (const state of ['Normal', 'Violated'] as const) {
      const frame = buildElkZoneChangeFrame(zoneNumber, state);
      assert.equal(frame.toString('ascii'), EXPECTED_FRAMES[zoneNumber][state]);
      assert.equal(frame.length, FRAME_LENGTH);
      assert.deepEqual([...frame.subarray(-2)], [0x0d, 0x0a]);
      assert.equal(frame.toString('ascii', 4, 7), String(zoneNumber).padStart(3, '0'));
    }
  }
});

test('ELK Zone Change generator rejects invalid zones and states', () => {
  for (const zoneNumber of [0, -1, 209, 1.5]) {
    assert.throws(() => buildElkZoneChangeFrame(zoneNumber, 'Normal'));
  }
  assert.throws(() => buildElkZoneChangeFrame(1, 'Invalid' as VirtualSecurityDesiredState));
});

test('multi-zone fixture retains independent state, resyncs, reconnects, and shuts down', async () => {
  const fixture = new SavantTcpTestFixtureServer({
    host: '127.0.0.1',
    port: 0,
    logger: { info: () => undefined }
  });
  const address = await fixture.start();
  const client = await connect(address.port);

  const initialSync = await readBytes(client, FRAME_LENGTH * 5);
  assert.equal(initialSync.toString('ascii'), SAVANT_TCP_TEST_ZONES
    .map((zone) => EXPECTED_FRAMES[zone].Normal)
    .join(''));

  const zone37Frame = readBytes(client, FRAME_LENGTH);
  assert.equal(fixture.command('set 37 violated'), true);
  assert.equal((await zone37Frame).toString('ascii'), EXPECTED_FRAMES[37].Violated);
  assert.deepEqual([...fixture.currentStates()], [
    [1, 'Normal'],
    [4, 'Normal'],
    [12, 'Normal'],
    [37, 'Violated'],
    [128, 'Normal']
  ]);

  const zone4Frame = readBytes(client, FRAME_LENGTH);
  fixture.command('set 4 violated');
  assert.equal((await zone4Frame).toString('ascii'), EXPECTED_FRAMES[4].Violated);

  let invalidCommandSentData = false;
  client.once('data', () => { invalidCommandSentData = true; });
  assert.equal(fixture.command('set 2 violated'), false);
  assert.equal(fixture.command('set 37 alarm'), false);
  assert.equal(fixture.command('unknown'), false);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(invalidCommandSentData, false);

  const resyncBytes = readBytes(client, FRAME_LENGTH * 5);
  assert.equal(fixture.command('resync'), true);
  assert.equal((await resyncBytes).toString('ascii'), SAVANT_TCP_TEST_ZONES
    .map((zone) => EXPECTED_FRAMES[zone][fixture.currentStates().get(zone) ?? 'Normal'])
    .join(''));

  client.destroy();
  await waitForClose(client);
  const retainedStates = fixture.currentStates();

  const reconnected = await connect(address.port);
  const reconnectBytes = await readBytes(reconnected, FRAME_LENGTH * 5);
  assert.equal(reconnectBytes.toString('ascii'), SAVANT_TCP_TEST_ZONES
    .map((zone) => EXPECTED_FRAMES[zone][retainedStates.get(zone) ?? 'Normal'])
    .join(''));
  assert.equal(retainedStates.get(4), 'Violated');
  assert.equal(retainedStates.get(37), 'Violated');

  await fixture.close();
  await waitForClose(reconnected);
  await assert.rejects(connect(address.port));
});
