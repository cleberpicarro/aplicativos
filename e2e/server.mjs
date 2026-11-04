/**
 * Sobe o SyncTasks para os roteiros de tela: apaga o banco de teste, liga a equipe de exemplo
 * (senha nerus2026) e inicia o servidor já compilado (rode "npm run build" antes).
 */
import pg from 'pg';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://nerus:nerus@localhost:5432/nerus_e2e';
const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, '/postgres') });
await admin.connect();
const name = new URL(url).pathname.slice(1);
const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name}"`);
await admin.end();

const db = new pg.Client({ connectionString: url });
await db.connect();
await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
await db.end();

process.env.DATABASE_URL = url;
process.env.SEED_DEMO = 'true';
process.env.PORT = process.env.E2E_PORT ?? '3100';
process.env.HOST = '127.0.0.1';
process.env.APP_URL = `http://127.0.0.1:${process.env.PORT}`;
await import('../apps/api/dist/src/server.js');
