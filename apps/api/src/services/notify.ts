import { config } from '../config.js';
import { one, type Db } from '../lib/db.js';

/** Aviso no app + e-mail na fila. O número da tarefa (#12) vai no assunto. */
export async function notify(
  db: Db,
  userId: string,
  type: string,
  text: string,
  card?: { id: string; num: number; title: string },
) {
  await db.query(`INSERT INTO notifications (user_id, card_id, type, text) VALUES ($1, $2, $3, $4)`, [userId, card?.id ?? null, type, text]);
  const user = await one(db, 'SELECT email, name, active FROM users WHERE id = $1', [userId]);
  if (!user || !user.active) return;
  const subject = card ? `[#${card.num}] ${text}` : text;
  const link = card ? `${config.appUrl}/#/tarefa/${card.id}` : config.appUrl;
  const body = `Olá, ${user.name.split(' ')[0]}.\n\n${text}${card ? `\n\nTarefa #${card.num}: ${card.title}` : ''}\n\nAbrir no SyncTasks: ${link}\n`;
  await queueEmail(db, user.email, subject, body);
}

export async function queueEmail(db: Db, to: string, subject: string, body: string) {
  await db.query(`INSERT INTO email_outbox (to_email, subject, body) VALUES ($1, $2, $3)`, [to, subject, body]);
}
