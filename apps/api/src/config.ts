import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pasta do pacote da API (funciona tanto em src/ quanto compilado em dist/src/). */
function apiRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (!fs.existsSync(path.join(dir, 'package.json')) || !fs.existsSync(path.join(dir, 'migrations'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error('Pasta da API não encontrada.');
    dir = up;
  }
  return dir;
}
export const API_ROOT = apiRoot();

// Lê o .env da raiz do projeto, se existir (as variáveis já definidas no ambiente têm prioridade).
const envFile = path.resolve(API_ROOT, '../../.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://nerus:nerus@localhost:5432/nerus',
  // No Render, RENDER_EXTERNAL_URL é preenchida automaticamente com o endereço público.
  appUrl: (process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  seedDemo: process.env.SEED_DEMO === 'true',
  production: process.env.NODE_ENV === 'production',
  timezone: 'America/Sao_Paulo',
  sessionDays: 30,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? 'Nerus Tasks <tarefas@localhost>',
  },
  // Front-end compilado (servido pela API em produção)
  webDist: process.env.WEB_DIST ?? path.resolve(API_ROOT, '../web/dist'),
};
