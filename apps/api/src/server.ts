import { config } from './config.js';
import { createPool } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { createMailer, processOutbox } from './lib/mailer.js';
import { buildApp } from './app.js';
import { tx } from './lib/db.js';
import { runReminders } from './services/reminders.js';
import { runFollowerMail } from './services/followers.js';
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

// Item 46: avisos de prazo e resumo diário por e-mail. Roda a cada 15 minutos (e logo depois de ligar);
// o que já foi enviado fica marcado no banco e não se repete.
const reminders = () => {
  tx(pool, (db) => runReminders(db))
    .then((r) => { if (r.eve + r.late + r.digests) app.log.info(r, 'avisos de prazo e resumo diário na fila'); })
    .catch((err) => app.log.error(err, 'falha ao preparar os avisos de prazo e o resumo diário'));
};
const reminderTimer = setInterval(reminders, 15 * 60_000);
const firstReminders = setTimeout(reminders, 30_000);

// Item 81: e-mail dos seguidores, quando a tarefa fica 5 minutos sem novidade nova. Confere a cada minuto.
const followerTimer = setInterval(() => {
  tx(pool, (db) => runFollowerMail(db))
    .then((r) => { if (r.sent) app.log.info(r, 'e-mails dos seguidores na fila'); })
    .catch((err) => app.log.error(err, 'falha ao preparar os e-mails dos seguidores'));
}, 60_000);

const shutdown = async () => {
  clearInterval(timer);
  clearInterval(reminderTimer);
  clearTimeout(firstReminders);
  clearInterval(followerTimer);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: config.host });
