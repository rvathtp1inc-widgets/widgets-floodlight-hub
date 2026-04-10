import fs from 'node:fs';
import path from 'node:path';
import { rawDb } from './client.js';

const migrationDir = path.resolve('drizzle');

rawDb.exec(`
  CREATE TABLE IF NOT EXISTS __migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

const migrationFiles = fs
  .readdirSync(migrationDir)
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

for (const fileName of migrationFiles) {
  const alreadyApplied = rawDb
    .prepare('SELECT 1 FROM __migrations WHERE filename = ? LIMIT 1')
    .get(fileName);

  if (alreadyApplied) {
    console.log('Skipping migration (already applied):', fileName);
    continue;
  }

  const migrationPath = path.join(migrationDir, fileName);
  const sql = fs.readFileSync(migrationPath, 'utf8');

  try {
    rawDb.exec('BEGIN');
    rawDb.exec(sql);
    rawDb.prepare('INSERT INTO __migrations (filename) VALUES (?)').run(fileName);
    rawDb.exec('COMMIT');
    console.log('Migration applied:', migrationPath);
  } catch (error) {
    rawDb.exec('ROLLBACK');
    throw new Error(`Failed migration ${fileName}: ${(error as Error).message}`);
  }
}
