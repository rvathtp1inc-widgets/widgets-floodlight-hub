import fs from 'node:fs';
import { buildApp } from './app.js';
import { config } from './config.js';
import './db/client.js';
import { verifyRequiredSchema } from './db/verifySchema.js';
import { buildSavantTestFixtureApp, SavantTestZoneStatus } from './routes/savantTestFixture.js';

function ensureDbReady() {
  if (!fs.existsSync('./drizzle/0000_init.sql')) {
    throw new Error('Missing migration file drizzle/0000_init.sql');
  }
}

async function start() {
  ensureDbReady();
  verifyRequiredSchema();
  const app = buildApp();
  let savantTestFixture: ReturnType<typeof buildSavantTestFixtureApp> | undefined;
  try {
    await app.listen({ host: config.host, port: config.port });
    if (process.env.SAVANT_TEST_FIXTURE_ENABLED === 'true') {
      const keyPath = process.env.SAVANT_TEST_TLS_KEY_PATH;
      const certPath = process.env.SAVANT_TEST_TLS_CERT_PATH;
      if (!keyPath || !certPath) {
        throw new Error('SAVANT_TEST_TLS_KEY_PATH and SAVANT_TEST_TLS_CERT_PATH are required for the Savant test fixture.');
      }

      const configuredStatus = process.env.SAVANT_TEST_ZONE_STATUS;
      if (configuredStatus !== undefined && configuredStatus !== 'Normal' && configuredStatus !== 'Violated') {
        throw new Error('SAVANT_TEST_ZONE_STATUS must be Normal or Violated.');
      }

      savantTestFixture = buildSavantTestFixtureApp({
        tls: {
          key: fs.readFileSync(keyPath),
          cert: fs.readFileSync(certPath)
        },
        initialZoneStatus: configuredStatus as SavantTestZoneStatus | undefined
      });
      await savantTestFixture.listen({ host: config.host, port: 8756 });
    }
  } catch (error) {
    await savantTestFixture?.close();
    await app.close();
    app.log.error(error);
    process.exit(1);
  }
}

start();
