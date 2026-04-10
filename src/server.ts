import fs from 'node:fs';
import { buildApp } from './app.js';
import { config } from './config.js';
import './db/client.js';
import { verifyRequiredSchema } from './db/verifySchema.js';

function ensureDbReady() {
  if (!fs.existsSync('./drizzle/0000_init.sql')) {
    throw new Error('Missing migration file drizzle/0000_init.sql');
  }
}

async function start() {
  ensureDbReady();
  verifyRequiredSchema();
  const app = buildApp();
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

start();
