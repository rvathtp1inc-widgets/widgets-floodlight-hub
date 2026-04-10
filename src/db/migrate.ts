import fs from 'node:fs';
import path from 'node:path';
import { rawDb } from './client.js';

function listMigrationFiles(): string[] {
  return fs
    .readdirSync(path.resolve('drizzle'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

function applyMigration(name: string, sql: string): void {
  rawDb.exec(sql);
  rawDb.prepare('INSERT INTO __migrations(name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
}

rawDb.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');

for (const file of listMigrationFiles()) {
  const alreadyApplied = rawDb.prepare('SELECT name FROM __migrations WHERE name = ?').get(file);
  if (alreadyApplied) continue;
  const filePath = path.resolve('drizzle', file);
  const sql = fs.readFileSync(filePath, 'utf8');
  try {
    applyMigration(file, sql);
    console.log('Migration applied:', file);
  } catch (error) {
    const text = (error as Error).message;
    if (text.includes('duplicate column name')) {
      rawDb.prepare('INSERT INTO __migrations(name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      console.log('Migration marked as applied (duplicate columns):', file);
      continue;
    }
    throw error;
  }
}
