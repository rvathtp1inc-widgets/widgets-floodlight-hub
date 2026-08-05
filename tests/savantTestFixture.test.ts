import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildSavantTestFixtureApp } from '../src/routes/savantTestFixture.js';

const certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'savant-fixture-tls-'));
const keyPath = path.join(certificateDirectory, 'key.pem');
const certPath = path.join(certificateDirectory, 'cert.pem');

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', keyPath, '-out', certPath, '-days', '1',
  '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1'
], { stdio: 'ignore' });

const tls = {
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath)
};

test.after(() => fs.rmSync(certificateDirectory, { recursive: true, force: true }));

test('Zone 1 fixture validates requests and switches deterministic state', async () => {
  const app = buildSavantTestFixtureApp({ tls, logger: { info: () => undefined } });

  const normal = await app.inject({
    method: 'POST',
    url: '/',
    headers: { 'content-type': 'application/json' },
    payload: { method: 'queryZoneStatus', zone: 1 }
  });
  assert.equal(normal.statusCode, 200);
  assert.match(normal.headers['content-type'] ?? '', /^application\/json\b/);
  assert.deepEqual(normal.json(), {
    result: {
      zoneNumber: 1,
      zoneLabel: 'Widgets Test Zone 1',
      zoneStatus: 'Normal'
    }
  });

  const invalidStatus = await app.inject({
    method: 'POST',
    url: '/test/savant-zone/1',
    payload: { zoneStatus: 'Alarm' }
  });
  assert.equal(invalidStatus.statusCode, 400);

  const switched = await app.inject({
    method: 'POST',
    url: '/test/savant-zone/1',
    payload: { zoneStatus: 'Violated' }
  });
  assert.equal(switched.statusCode, 200);

  const violated = await app.inject({
    method: 'POST',
    url: '/',
    payload: { method: 'queryZoneStatus', zone: 1 }
  });
  assert.equal(violated.json().result.zoneStatus, 'Violated');

  const invalidMethod = await app.inject({
    method: 'POST',
    url: '/',
    payload: { method: 'other', zone: 1 }
  });
  assert.equal(invalidMethod.statusCode, 400);

  const invalidZone = await app.inject({
    method: 'POST',
    url: '/',
    payload: { method: 'queryZoneStatus', zone: 2 }
  });
  assert.equal(invalidZone.statusCode, 400);

  await app.close();
});

test('fixture is reachable over HTTPS', async () => {
  const app = buildSavantTestFixtureApp({ tls, logger: { info: () => undefined } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address === 'object');

  const response = await new Promise<{ statusCode?: number; contentType?: string; body: string }>((resolve, reject) => {
    const request = https.request({
      host: '127.0.0.1',
      port: address.port,
      path: '/',
      method: 'POST',
      rejectUnauthorized: false,
      headers: { 'content-type': 'application/json' }
    }, (incoming) => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk) => { body += chunk; });
      incoming.on('end', () => resolve({
        statusCode: incoming.statusCode,
        contentType: incoming.headers['content-type'],
        body
      }));
    });
    request.on('error', reject);
    request.end(JSON.stringify({ method: 'queryZoneStatus', zone: 1 }));
  });

  assert.equal(response.statusCode, 200);
  assert.match(response.contentType ?? '', /^application\/json\b/);
  assert.equal(JSON.parse(response.body).result.zoneStatus, 'Normal');
  await app.close();
});
