import { one, type Db } from '../lib/db.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { hashPassword, newToken, sha256, verifyPassword } from '../lib/passwords.js';
import { config } from '../config.js';
import { toActor, type Actor } from './actors.js';
import { createPasswordToken } from './admin.js';
import { queueEmail } from './notify.js';

export async function login(db: Db, email: string, password: string) {
  const u = await one(db, 'SELECT * FROM users WHERE lower(email) = lower($1) AND active', [email.trim()]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw unauthorized('E-mail ou senha incorretos.');
  const token = newToken();
  await db.query(
    `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [sha256(token), u.id, String(config.sessionDays)],
  );
  return { token, actor: toActor(u) };
}

export async function actorFromSession(db: Db, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const u = await one(
    db,
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)],
  );
  return u ? toActor(u) : null;
}

export async function logout(db: Db, token: string | undefined) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export function validatePassword(pw: string) {
  if (pw.length < 8) throw badRequest('A senha precisa ter pelo menos 8 caracteres.');
}

export async function setPassword(db: Db, token: string, password: string) {
  validatePassword(password);
  const t = await one(
    db,
    `SELECT pt.user_id FROM password_tokens pt JOIN users u ON u.id = pt.user_id
      WHERE pt.token_hash = $1 AND pt.used_at IS NULL AND pt.expires_at > now() AND u.active FOR UPDATE OF pt`,
    [sha256(token)],
  );
  if (!t) throw badRequest('Este link expirou ou já foi usado. Peça um novo em “Esqueci minha senha”.');
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [t.user_id, await hashPassword(password)]);
  await db.query('UPDATE password_tokens SET used_at = now() WHERE token_hash = $1', [sha256(token)]);
  await db.query('DELETE FROM sessions WHERE user_id = $1', [t.user_id]);
}

/** Sempre responde igual, exista ou não o e-mail (não revela cadastro). */
export async function forgotPassword(db: Db, email: string) {
  const u = await one(db, 'SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND active', [email.trim()]);
  if (!u) return;
  const token = await createPasswordToken(db, u.id, 2);
  await queueEmail(
    db,
    u.email,
    'Redefinir sua senha do SyncTask',
    `Olá, ${u.name.split(' ')[0]}.\n\nPara definir uma nova senha, use o link abaixo (válido por 2 horas):\n\n${config.appUrl}/#/definir-senha?token=${token}\n\nSe não foi você, ignore este e-mail.\n`,
  );
}
