import { one, many, type Db } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { newToken, sha256 } from '../lib/passwords.js';
import { config } from '../config.js';
import type { Actor } from './actors.js';
import { createBoard } from './boards.js';
import { logEvent } from './events.js';
import { notify, queueEmail } from './notify.js';

export const LEVEL_TITLES = ['CEO', 'Diretor', 'Gestor', 'Funcionário'];

export async function listUsers(db: Db) {
  return many(
    db,
    `SELECT u.id, u.name, u.email, u.level, u.role_title, u.manager_id, m.name AS manager_name, u.is_admin, u.active,
            (u.password_hash IS NOT NULL) AS has_password,
            (SELECT count(*)::int FROM users s WHERE s.manager_id = u.id AND s.active) AS reports
       FROM users u LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.level NULLS LAST, u.name`,
  );
}

async function validateManager(db: Db, level: number | null, managerId: string | null | undefined) {
  if (level === null) {
    if (managerId) throw badRequest('Administrador fora da hierarquia não tem superior.');
    return null;
  }
  if (level === 0) {
    if (managerId) throw badRequest('O CEO não tem superior.');
    const ceo = await one(db, 'SELECT id FROM users WHERE level = 0 AND active');
    if (ceo) throw conflict('Já existe um CEO ativo.');
    return null;
  }
  if (!managerId) throw badRequest('Escolha o superior direto.');
  const m = await one(db, 'SELECT level, active FROM users WHERE id = $1', [managerId]);
  if (!m || !m.active) throw badRequest('Superior não encontrado.');
  if (m.level !== level - 1) throw badRequest(`O superior de um ${LEVEL_TITLES[level]} deve ser um ${LEVEL_TITLES[level - 1]}.`);
  return managerId;
}

export async function createPasswordToken(db: Db, userId: string, hours = 72) {
  const token = newToken();
  await db.query(`INSERT INTO password_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' hours')::interval)`, [sha256(token), userId, String(hours)]);
  return token;
}

export async function sendInvite(db: Db, user: { id: string; name: string; email: string }) {
  const token = await createPasswordToken(db, user.id);
  const link = `${config.appUrl}/#/definir-senha?token=${token}`;
  await queueEmail(
    db,
    user.email,
    'Seu acesso ao Nerus Tasks',
    `Olá, ${user.name.split(' ')[0]}.\n\nVocê foi cadastrado(a) no Nerus Tasks. Defina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`,
  );
  return token;
}

export interface NewUser {
  name: string;
  email: string;
  level: number | null;
  roleTitle?: string;
  managerId?: string | null;
  isAdmin?: boolean;
}

export async function createUser(db: Db, input: NewUser) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) throw badRequest('Informe o nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Informe um e-mail válido.');
  if (input.level === null && !input.isAdmin) throw badRequest('Escolha o cargo.');
  if (await one(db, 'SELECT 1 FROM users WHERE lower(email) = $1', [email])) throw conflict('Já existe uma pessoa com este e-mail.');
  const managerId = await validateManager(db, input.level, input.managerId);
  const roleTitle = input.roleTitle?.trim() || (input.level === null ? 'Administrador' : LEVEL_TITLES[input.level]);
  const user = await one(
    db,
    `INSERT INTO users (name, email, level, role_title, manager_id, is_admin) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, email`,
    [name, email, input.level, roleTitle, managerId, !!input.isAdmin],
  );
  if (input.level !== null) await createBoard(db, user.id, 'Meu trabalho');
  const token = await sendInvite(db, user);
  return { user, token };
}

export async function updateUser(db: Db, id: string, patch: { name?: string; email?: string; roleTitle?: string; isAdmin?: boolean }) {
  const u = await one(db, 'SELECT * FROM users WHERE id = $1', [id]);
  if (!u) throw notFound('Pessoa não encontrada.');
  if (patch.email !== undefined) {
    const e = patch.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw badRequest('Informe um e-mail válido.');
    if (await one(db, 'SELECT 1 FROM users WHERE lower(email) = $1 AND id <> $2', [e, id])) throw conflict('Já existe uma pessoa com este e-mail.');
    await db.query('UPDATE users SET email = $2, updated_at = now() WHERE id = $1', [id, e]);
  }
  if (patch.name !== undefined && patch.name.trim()) await db.query('UPDATE users SET name = $2, updated_at = now() WHERE id = $1', [id, patch.name.trim()]);
  if (patch.roleTitle !== undefined && patch.roleTitle.trim()) await db.query('UPDATE users SET role_title = $2, updated_at = now() WHERE id = $1', [id, patch.roleTitle.trim()]);
  if (patch.isAdmin !== undefined) {
    if (!patch.isAdmin && u.level === null) throw conflict('Esta pessoa só existe como administradora.');
    await db.query('UPDATE users SET is_admin = $2, updated_at = now() WHERE id = $1', [id, patch.isAdmin]);
  }
}

/** RN-38 a RN-41: muda o superior; as delegações em aberto do superior antigo passam ao novo. */
export async function transferManagement(db: Db, admin: Actor, userId: string, newManagerId: string) {
  const u = await one(db, 'SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!u || !u.active) throw notFound('Pessoa não encontrada.');
  if (u.level === null || u.level === 0) throw conflict('Esta pessoa não tem superior na hierarquia.');
  if (u.manager_id === newManagerId) throw badRequest('Esta pessoa já responde a este superior.');
  const m = await one(db, 'SELECT id, name, level, active FROM users WHERE id = $1', [newManagerId]);
  if (!m || !m.active || m.level !== u.level - 1) throw badRequest(`O novo superior deve ser um ${LEVEL_TITLES[u.level - 1]} ativo.`);
  const old = await one(db, 'SELECT id, name FROM users WHERE id = $1', [u.manager_id]);

  const moved = await many(
    db,
    `UPDATE delegations d SET delegator_id = $3, updated_at = now()
       FROM cards c
      WHERE c.id = d.card_id AND c.owner_id = $1 AND d.delegator_id = $2
        AND d.status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED')
      RETURNING d.card_id`,
    [userId, u.manager_id, newManagerId],
  );
  for (const r of moved) {
    await logEvent(db, r.card_id, admin.id, 'management_transferred', { delegator: old?.name ?? null }, { delegator: m.name });
  }
  await db.query('UPDATE users SET manager_id = $2, updated_at = now() WHERE id = $1', [userId, newManagerId]);
  await db.query(
    `INSERT INTO manager_changes (user_id, from_manager_id, to_manager_id, admin_id, moved_open_delegations) VALUES ($1, $2, $3, $4, $5)`,
    [userId, u.manager_id, newManagerId, admin.id, moved.length],
  );
  const firstName = u.name.split(' ')[0];
  await notify(db, userId, 'management', `Mudança de gestão: agora você responde a ${m.name}`);
  await notify(db, newManagerId, 'management', `Mudança de gestão: ${u.name} agora responde a você (${moved.length} delegação(ões) em aberto passaram para você)`);
  if (old) await notify(db, old.id, 'management', `Mudança de gestão: ${firstName} passou a responder a ${m.name}. O histórico fica com você.`);
  return { moved: moved.length };
}

/** RN-42/43: desativar exige que a pessoa não tenha subordinados nem delegações em aberto. */
export async function setActive(db: Db, admin: Actor, userId: string, active: boolean) {
  const u = await one(db, 'SELECT * FROM users WHERE id = $1', [userId]);
  if (!u) throw notFound('Pessoa não encontrada.');
  if (u.id === admin.id && !active) throw conflict('Você não pode desativar a si mesmo.');
  if (!active) {
    const pend = await one(
      db,
      `SELECT
         (SELECT count(*)::int FROM users WHERE manager_id = $1 AND active) AS reports,
         (SELECT count(*)::int FROM delegations d WHERE d.delegator_id = $1 AND d.status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED')) AS delegated,
         (SELECT count(*)::int FROM delegations d JOIN cards c ON c.id = d.card_id WHERE c.owner_id = $1 AND d.status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK')) AS received`,
      [userId],
    );
    const items = [];
    if (pend.reports) items.push(`${pend.reports} subordinado(s)`);
    if (pend.delegated) items.push(`${pend.delegated} delegação(ões) feitas em aberto`);
    if (pend.received) items.push(`${pend.received} tarefa(s) recebida(s) em aberto`);
    if (items.length) throw conflict(`Antes de desativar, transfira: ${items.join(', ')}.`);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
  await db.query('UPDATE users SET active = $2, updated_at = now() WHERE id = $1', [userId, active]);
}
