import webpush from 'web-push';
import { config } from '../config.js';
import { many, one, type Db } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';

/**
 * Item 119 (F6 da revisão geral): avisos no aparelho pelas notificações do navegador (Web Push).
 * Quem liga em Meus dados recebe no celular ou no computador os mesmos avisos da tela Avisos, na hora.
 * Desligado enquanto o servidor não tiver as chaves VAPID.
 */

export const pushEnabled = () => !!(config.push.publicKey && config.push.privateKey);

export function publicKey() {
  return pushEnabled() ? config.push.publicKey : null;
}

export async function subscribe(db: Db, userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent?: string) {
  if (!pushEnabled()) throw badRequest('Os avisos no aparelho ainda não foram ligados no servidor.');
  if (!/^https:\/\//.test(sub.endpoint)) throw badRequest('Endereço de entrega inválido.');
  // O mesmo aparelho pode ter sido de outra pessoa (computador compartilhado): fica com quem ligou por último.
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5, failures = 0, created_at = now()`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300) ?? null],
  );
  const n = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [userId]);
  return { ok: true, devices: n!.n };
}

export async function unsubscribe(db: Db, userId: string, endpoint: string) {
  await db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  return { ok: true };
}

export async function status(db: Db, userId: string) {
  const n = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1', [userId]);
  return { publicKey: publicKey(), devices: n!.n };
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }
export type PushSender = (sub: PushSub, payload: string) => Promise<void>;

const defaultSender: PushSender = async (sub, payload) => {
  const subject = config.push.subject ?? (config.appUrl.startsWith('https://') ? config.appUrl : 'mailto:avisos@synctasks.invalid');
  await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
    vapidDetails: { subject, publicKey: config.push.publicKey!, privateKey: config.push.privateKey! },
    TTL: 60 * 60 * 12,
    urgency: 'normal',
  });
};

/**
 * Entrega os avisos novos (dos últimos 30 minutos) para os aparelhos de cada pessoa. Roda a cada 10 segundos.
 * Aviso de quem não tem aparelho ligado é só marcado. Aparelho que o navegador diz não existir mais (404/410) sai da lista;
 * depois de 10 falhas seguidas também.
 */
export async function runPush(db: Db, send: PushSender = defaultSender) {
  if (!pushEnabled() && send === defaultSender) return { sent: 0 };
  const rows = await many(
    db,
    `UPDATE notifications n SET pushed_at = now()
      WHERE n.id IN (SELECT id FROM notifications WHERE pushed_at IS NULL AND created_at > now() - interval '30 minutes'
                      ORDER BY created_at LIMIT 200 FOR UPDATE SKIP LOCKED)
      RETURNING n.id, n.user_id, n.card_id, n.text`,
  );
  // Os mais antigos que isso não valem mais a pena (o servidor ficou fora do ar, por exemplo).
  await db.query(`UPDATE notifications SET pushed_at = now() WHERE pushed_at IS NULL AND created_at <= now() - interval '30 minutes'`);
  if (!rows.length) return { sent: 0 };
  const subs = await many(db, 'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1)', [[...new Set(rows.map((r) => r.user_id))]]);
  let sent = 0;
  for (const n of rows) {
    const payload = JSON.stringify({ title: 'SyncTasks', body: n.text, url: n.card_id ? `/#/tarefa/${n.card_id}` : '/#/avisos', tag: n.id });
    for (const s of subs.filter((x) => x.user_id === n.user_id)) {
      try {
        await send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, payload);
        await db.query('UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1', [s.id]);
        sent++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
        else {
          await db.query('DELETE FROM push_subscriptions WHERE id = $1 AND failures >= 9', [s.id]);
          await db.query('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1', [s.id]);
        }
      }
    }
  }
  return { sent };
}
