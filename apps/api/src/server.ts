import { config } from './config.js';
import { createPool } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { createMailer, processOutbox } from './lib/mailer.js';
import { buildApp } from './app.js';
import { tx } from './lib/db.js';
import { seedDemo } from '../scripts/seed-demo.js';

const pool = createPool(config.databaseUrl);
const app = await buildApp({ pool, logger: true, serveWeb: true });
await migrate(pool, (m) => app.log.info(m));
if (config.seedDemo) {
  // Ambiente de demonstração: cria a equipe de exemplo só se o banco ainda não tiver ninguém.
  const created = await tx(pool, seedDemo);
  if (created) app.log.info('Dados de demonstração criados (senha de todos: nerus2026).');
}

const mailer = createMailer((m) => app.log.info(m));
const timer = setInterval(() => {
  processOutbox(pool, mailer).catch((err) => app.log.error(err, 'falha ao processar a fila de e-mails'));
}, 10_000);

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
