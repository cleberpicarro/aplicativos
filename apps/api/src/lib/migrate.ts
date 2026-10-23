import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from './db.js';
import { API_ROOT } from '../config.js';

const dir = path.join(API_ROOT, 'migrations');

export async function migrate(pool: Pool, log: (m: string) => void = () => {}): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log(`migração aplicada: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
