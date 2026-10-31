import nodemailer from 'nodemailer';
import { config } from '../config.js';
import type { Pool } from './db.js';

export interface Mailer {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Envia pelo SMTP configurado (Google Workspace). Sem SMTP_HOST, apenas escreve no log. */
export function createMailer(log: (m: string) => void): Mailer {
  if (!config.smtp.host) {
    return {
      async send(to, subject, body) {
        log(`[e-mail simulado] Para: ${to} | Assunto: ${subject}\n${body}`);
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return {
    async send(to, subject, body) {
      await transport.sendMail({ from: config.smtp.from, to, subject, text: body });
    },
  };
}

/** Processa a fila de e-mails. Uma falha não bloqueia nada no app; tenta até 5 vezes. */
export async function processOutbox(pool: Pool, mailer: Mailer, limit = 20): Promise<number> {
  const client = await pool.connect();
  let sent = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT * FROM email_outbox WHERE status = 'pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const m of rows) {
      try {
        await mailer.send(m.to_email, m.subject, m.body);
        await client.query(`UPDATE email_outbox SET status='sent', sent_at=now(), attempts=attempts+1 WHERE id=$1`, [m.id]);
        sent++;
      } catch (err) {
        const attempts = m.attempts + 1;
        await client.query(
          `UPDATE email_outbox SET attempts=$2, last_error=$3, status=CASE WHEN $2 >= 5 THEN 'failed' ELSE 'pending' END WHERE id=$1`,
          [m.id, attempts, String((err as Error).message).slice(0, 500)],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return sent;
}
