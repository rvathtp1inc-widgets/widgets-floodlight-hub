import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config } from '../config.js';

const dataDir = path.dirname(config.dbPath);
if (dataDir && dataDir !== '.') {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
export const rawDb = sqlite;
