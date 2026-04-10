import fs from 'node:fs';
import path from 'node:path';
import { rawDb } from './client.js';

const migrationPath = path.resolve('drizzle/0000_init.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
rawDb.exec(sql);
console.log('Migration applied:', migrationPath);
