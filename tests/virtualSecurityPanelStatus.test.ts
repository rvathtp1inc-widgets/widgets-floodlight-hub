import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import net from 'node:net';
import {
  createVirtualSecurityPanelStatusProvider,
  virtualSecurityPanelStatusRoutes
} from '../src/routes/virtualSecurityPanelStatus.js';
import { VirtualSecurityPanelConsumer, VirtualSecurityPanelLifecycle, VirtualSecurityPanelStatus } from '../src/services/virtualSecurityPanel/types.js';
import { SavantTcpTransport } from '../src/services/virtualSecurityPanel/savantTcpTransport.js';

class StatusConsumer implements VirtualSecurityPanelConsumer {
  status: VirtualSecurityPanelStatus;
  constructor(lifecycle: VirtualSecurityPanelLifecycle = 'stopped', connected = false, retainedCount = 0) {
    this.status = {
      lifecycle, connected,
      lastClientConnectedAt: null, lastClientDisconnectedAt: null, lastTransportError: null,
      retainedStates: Array.from({ length: retainedCount }, (_, index) => ({
        zoneNumber: index + 1, currentState: 'Normal', lastChangedAt: '2026-08-06T00:00:00.000Z', deliveryStatus: 'never_sent'
      }))
    };
  }
  async start() {}
  async stop() {}
  async setDesiredState() { return { accepted: true, changed: false, delivered: false, retained: true, reason: 'state_unchanged' as const }; }
  getStatus() { return { ...this.status, retainedStates: this.status.retainedStates.map((state) => ({ ...state })) }; }
}

const config = { enabled: true, listenHost: '0.0.0.0', listenPort: 2101 };
const bindings = [
  { bindingJson: '{"panelKey":"default","zoneNumber":4}' },
  { bindingJson: '{"panelKey":"default","zoneNumber":4}' },
  { bindingJson: '{"panelKey":"default","zoneNumber":208}' },
  { bindingJson: '{"panelKey":"other","zoneNumber":5}' },
  { bindingJson: '{"panelKey":"default","zoneNumber":0}' },
  { bindingJson: '{"panelKey":"default","zoneNumber":209}' },
  { bindingJson: '{"panelKey":"default","zoneNumber":1.5}' },
  { bindingJson: 'malformed' }
];

test('status provider maps lifecycle and exposes only stable service fields', async () => {
  const mappings: Array<[VirtualSecurityPanelLifecycle, string, boolean]> = [
    ['stopped', 'stopped', false], ['starting', 'starting', false], ['listening', 'listening', false],
    ['connected', 'listening', true], ['stopping', 'stopped', false], ['faulted', 'error', false]
  ];
  for (const [lifecycle, expected, connected] of mappings) {
    const consumer = new StatusConsumer(lifecycle, connected, 3);
    consumer.status.lastClientConnectedAt = connected ? '2026-08-06T16:13:57.350Z' : null;
    const result = await createVirtualSecurityPanelStatusProvider({ config, consumer, readEnabledBindingJson: () => bindings }).getStatus();
    assert.equal(result.listenerState, expected);
    assert.equal(result.savantClientConnected, connected);
    assert.equal(result.configuredZoneCount, 2);
    assert.equal(result.retainedZoneCount, 3);
    assert.deepEqual(Object.keys(result), ['enabled', 'listenerState', 'listenHost', 'listenPort', 'savantClientConnected', 'configuredZoneCount', 'retainedZoneCount', 'lastClientConnectedAt', 'lastClientDisconnectedAt', 'lastTransportError']);
    assert.equal(JSON.stringify(result).includes('retainedStates'), false);
  }
});

test('disabled status reports configured zones but suppresses all runtime state', async () => {
  const consumer = new StatusConsumer('connected', true, 2);
  consumer.status.lastClientConnectedAt = '2026-08-06T16:13:57.350Z';
  consumer.status.lastClientDisconnectedAt = '2026-08-06T16:08:41.221Z';
  consumer.status.lastTransportError = { timestamp: '2026-08-06T16:14:02.441Z', code: 'transport_send_failed', message: 'Failed to write Virtual Security Panel state to the connected client.' };
  const result = await createVirtualSecurityPanelStatusProvider({ config: { ...config, enabled: false }, consumer, readEnabledBindingJson: () => bindings }).getStatus();
  assert.deepEqual(result, {
    enabled: false, listenerState: 'disabled', listenHost: '0.0.0.0', listenPort: 2101,
    savantClientConnected: false, configuredZoneCount: 2, retainedZoneCount: 0,
    lastClientConnectedAt: null, lastClientDisconnectedAt: null, lastTransportError: null
  });
});

test('route is GET-only, returns 200 for normal states, and query inspection failures return 500', async () => {
  const app = Fastify();
  await virtualSecurityPanelStatusRoutes(app, createVirtualSecurityPanelStatusProvider({ config, consumer: new StatusConsumer('listening'), readEnabledBindingJson: () => [] }));
  assert.equal((await app.inject({ method: 'GET', url: '/api/virtual-security-panel/status' })).statusCode, 200);
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await app.inject({ method, url: '/api/virtual-security-panel/status' })).statusCode, 404);
  await app.close();

  const failing = Fastify();
  await virtualSecurityPanelStatusRoutes(failing, createVirtualSecurityPanelStatusProvider({ config, readEnabledBindingJson: () => { throw new Error('database unavailable'); } }));
  const response = await failing.inject({ method: 'GET', url: '/api/virtual-security-panel/status' });
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'Internal Server Error');
  await failing.close();
});

const logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

test('transport status records sanitized listener and send errors without raw error details', async () => {
  const occupied = net.createServer();
  await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const address = occupied.address();
  assert.ok(address && typeof address === 'object');
  const bindTransport = new SavantTcpTransport({ host: '127.0.0.1', port: address.port, logger, now: () => '2026-08-06T16:14:01.000Z' });
  await assert.rejects(bindTransport.start());
  assert.deepEqual(bindTransport.getStatus().lastTransportError, {
    timestamp: '2026-08-06T16:14:01.000Z', code: 'listener_bind_failed', message: 'Virtual Security Panel listener failed to start.'
  });
  await new Promise<void>((resolve) => occupied.close(() => resolve()));

  const times = ['2026-08-06T16:14:02.000Z', '2026-08-06T16:14:02.441Z'];
  const sendTransport = new SavantTcpTransport({
    host: '127.0.0.1', port: 0, logger, now: () => times.shift() ?? '2026-08-06T16:14:03.000Z',
    frameWriter: async () => { throw new Error('raw write failure with stack'); }
  });
  await sendTransport.start();
  const listeningAddress = sendTransport.getStatus().listeningAddress;
  assert.ok(listeningAddress);
  const client = net.createConnection({ host: '127.0.0.1', port: Number(listeningAddress.slice(listeningAddress.lastIndexOf(':') + 1)) });
  await new Promise<void>((resolve, reject) => { client.once('connect', resolve); client.once('error', reject); });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(sendTransport.send(Buffer.from('frame')));
  const status = sendTransport.getStatus();
  assert.deepEqual(status.lastTransportError, {
    timestamp: '2026-08-06T16:14:02.441Z', code: 'transport_send_failed', message: 'Failed to write Virtual Security Panel state to the connected client.'
  });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('stack'), false);
  assert.equal(serialized.includes('raw write failure'), false);
  assert.equal(serialized.includes('remoteAddress'), false);
  client.destroy();
  await sendTransport.stop();
});
