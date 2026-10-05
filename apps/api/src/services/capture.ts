import { one, type Db } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { logEvent } from './events.js';

/**
 * Item 14: cria uma tarefa a partir da página que a pessoa está vendo no navegador.
 * A tarefa vai para a caixa de entrada, marcada como "capturada da web", para ser organizada depois.
 */
/** E-mail aberto no Gmail: o link abre a própria mensagem (mail.google.com/mail/u/0/#inbox/<id>). */
export function isGmailMessage(url: string) {
  try {
    const u = new URL(url);
    return u.hostname === 'mail.google.com' && /^#[^/]+\/[A-Za-z0-9_-]{10,}/.test(u.hash);
  } catch {
    return false;
  }
}

/** Tira da aba do Gmail o que não é o assunto: "Assunto - nome@empresa.com - Gmail". */
export function cleanGmailTitle(title: string) {
  return title.replace(/\s+-\s+\S+@\S+\s+-\s+Gmail\s*$/i, '').replace(/\s+-\s+Gmail\s*$/i, '').trim();
}

export async function captureWeb(db: Db, actor: Actor, input: { title: string; url: string; text?: string }) {
  if (actor.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros.');
  const url = input.url.trim();
  if (url && !/^https?:\/\//i.test(url)) throw badRequest('O endereço precisa começar com http:// ou https://.');
  const email = isGmailMessage(url);
  let title = email ? cleanGmailTitle(input.title) : input.title.trim();
  if (!title && url) {
    try {
      title = new URL(url).hostname;
    } catch {
      title = url;
    }
  }
  if (!title) throw badRequest('Informe um título ou um endereço.');
  if (title.length > 200) title = `${title.slice(0, 199)}…`;
  const text = (input.text ?? '').trim();
  const description = [url, text ? `“${text}”` : ''].filter(Boolean).join('\n\n');
  const card = await one(
    db,
    `INSERT INTO cards (owner_id, list_id, title, description, source, created_by) VALUES ($1, NULL, $2, $3, $4, $1) RETURNING id, code, title`,
    [actor.id, title, description, email ? 'email' : 'web'],
  );
  await logEvent(db, card.id, actor.id, 'captured', undefined, { url: url || null, ...(email ? { email: true } : {}) });
  return { id: card.id as string, code: card.code as string };
}
