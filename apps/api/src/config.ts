import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://nerus:nerus@localhost:5432/nerus',
  appUrl: (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
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
  webDist: process.env.WEB_DIST ?? path.resolve(here, '../../web/dist'),
};
