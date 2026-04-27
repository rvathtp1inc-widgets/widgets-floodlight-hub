import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractWebhookDeviceIdentifier,
  normalizeWebhookEvent
} from '../src/services/webhooks/normalizeWebhookEvent.js';

const alarmManagerPayload = {
  alarm: {
    sources: [{
      device: '68D79AE34B7F',
      zones: {
        zone: [2]
      }
    }],
    conditions: [{
      condition: {
        source: 'person',
        type: 'is'
      }
    }]
  }
};

test('Alarm Manager zone payload normalizes to Protect zone route fields', () => {
  const event = normalizeWebhookEvent({
    webhookKey: 'driveway',
    payload: alarmManagerPayload,
    receivedAt: '2026-04-27T00:00:00.000Z',
    targetHintType: 'floodlight',
    targetHintId: 1,
    sharedSecretValidated: true,
    resolvedSource: {
      sourceType: 'protect_source',
      sourceId: 5,
      protectCameraId: 'camera-5',
      name: 'Driveway',
      modelKey: 'camera',
      state: 'CONNECTED',
      lastSeenAt: '2026-04-27T00:00:00.000Z',
      lastEventSeenAt: null
    }
  });

  assert.equal(event.source, 'protect_webhook');
  assert.equal(event.ingressType, 'webhook');
  assert.equal(event.cameraId, '68D79AE34B7F');
  assert.equal(event.eventClass, 'zone');
  assert.equal(event.eventType, 'smartDetectZone');
  assert.deepEqual(event.objectTypes, ['person']);
  assert.equal(event.raw, alarmManagerPayload);
  assert.equal(event.precision.webhookKey, 'driveway');
  assert.equal(event.precision.targetHintType, 'floodlight');
  assert.equal(event.precision.targetHintId, 1);
  assert.equal(event.precision.sharedSecretValidated, true);
  assert.equal(event.resolvedSource?.sourceType, 'protect_source');
  assert.equal(event.resolvedSource?.sourceId, 5);
});

test('Alarm Manager line payload normalizes to Protect line route fields', () => {
  const event = normalizeWebhookEvent({
    webhookKey: 'driveway',
    payload: {
      alarm: {
        sources: [{
          device: '68:D7:9A:E3:4B:7F',
          zones: {
            line: [1]
          }
        }],
        conditions: [{
          condition: {
            source: 'vehicle',
            type: 'is'
          }
        }]
      }
    },
    receivedAt: '2026-04-27T00:00:00.000Z',
    targetHintType: null,
    targetHintId: null,
    sharedSecretValidated: true,
    resolvedSource: null
  });

  assert.equal(event.eventClass, 'line');
  assert.equal(event.eventType, 'smartDetectLine');
  assert.deepEqual(event.objectTypes, ['vehicle']);
});

test('Alarm Manager source device is extracted as webhook device identifier', () => {
  assert.equal(extractWebhookDeviceIdentifier(alarmManagerPayload), '68D79AE34B7F');
});
