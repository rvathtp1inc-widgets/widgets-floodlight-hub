import fs from 'node:fs';
import { buildSavantTestFixtureApp } from './routes/savantTestFixture.js';
import type { SavantTestZoneStatus } from './routes/savantTestFixture.js';

const keyPath = process.env.SAVANT_TEST_TLS_KEY_PATH;
const certPath = process.env.SAVANT_TEST_TLS_CERT_PATH;

if (!keyPath || !certPath) {
  throw new Error('SAVANT_TEST_TLS_KEY_PATH and SAVANT_TEST_TLS_CERT_PATH are required.');
}

const configuredStatus = process.env.SAVANT_TEST_ZONE_STATUS;
let initialZoneStatus: SavantTestZoneStatus | undefined;
if (configuredStatus === 'Normal' || configuredStatus === 'Violated') {
  initialZoneStatus = configuredStatus;
} else if (configuredStatus !== undefined) {
  throw new Error('SAVANT_TEST_ZONE_STATUS must be Normal or Violated.');
}

const configuredPort = process.env.SAVANT_TEST_PORT ?? '8756';
const port = Number(configuredPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SAVANT_TEST_PORT must be an integer from 1 through 65535.');
}

const host = process.env.SAVANT_TEST_HOST?.trim() || '0.0.0.0';
const app = buildSavantTestFixtureApp({
  tls: {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  },
  initialZoneStatus
});

let closing = false;
async function closeFixture(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
}

process.once('SIGINT', () => {
  void closeFixture();
});
process.once('SIGTERM', () => {
  void closeFixture();
});

await app.listen({ host, port });
