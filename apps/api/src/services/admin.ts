import { one, many, type Db } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { newToken, sha256 } from '../lib/passwords.js';
import { config } from '../config.js';
import type { Actor } from './actors.js';
import { createBoard } from './boards.js';
import { logEvent } from './events.js';
import { notify, queueEmail } from './notify.js';

export const LEVEL_TITLES = ['CEO', 'Diretor', 'Gestor', 'Funcionário'];

/**
 * RN-38: o superior está num nível acima. O gestor pode responder a um diretor ou direto ao CEO (item 29);
 * o funcionário, a um gestor, a um diretor ou direto ao CEO (item 32).
 */
export function managerLevelsFor(level: number): number[] {
  return level === 3 ? [2, 1, 0] : level === 2 ? [1, 0] : [level - 1];
}

function managerLabel(level: number) {
  const t = managerLevelsFor(level).map((l) => LEVEL_TITLES[l]);
  return t.length > 1 ? `${t.slice(0, -1).join(', ')} ou ${t[t.length - 1]}` : t[0];
}

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
  if (!managerLevelsFor(level).includes(m.level)) throw badRequest(`O superior de um ${LEVEL_TITLES[level]} deve ser um ${managerLabel(level)}.`);
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
    'Seu acesso ao SyncTasks',
    `Olá, ${user.name.split(' ')[0]}.\n\nVocê foi cadastrado(a) no SyncTasks. Defina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`,
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

export async function updateUser(db: Db, actor: Actor, id: string, patch: { name?: string; email?: string; roleTitle?: string; isAdmin?: boolean }) {
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
    if (!patch.isAdmin && id === actor.id) throw conflict('Você não pode tirar o seu próprio acesso de administrador.');
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
  if (!m || !m.active || !managerLevelsFor(u.level).includes(m.level)) throw badRequest(`O novo superior deve ser um ${managerLabel(u.level)} ativo.`);
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
    if (items.length) throw conflict(`Antes de desativar, transfira: ${items.join(', ')}.${pend.reports ? ' Para os subordinados, troque o superior direto em Editar dados.' : ''}`);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }
  await db.query('UPDATE users SET active = $2, updated_at = now() WHERE id = $1', [userId, active]);
}

/* ---------- desativar resolvendo as pendências (item 44) ---------- */

const OPEN_MADE = `('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED')`;

/** Tarefas próprias abertas que passam ao sucessor: não concluídas, não arquivadas, não privadas e não recebidas por delegação. */
const OWN_OPEN = `SELECT c.id FROM cards c
  WHERE c.owner_id = $1 AND c.archived_at IS NULL AND c.completed_at IS NULL AND NOT c.is_private
    AND NOT EXISTS (SELECT 1 FROM delegations d WHERE d.card_id = c.id)`;

/** O que está pendente com a pessoa e quem pode ser o sucessor (alguém do mesmo nível ou o superior dela). */
export async function deactivationPreview(db: Db, userId: string) {
  const u = await one(db, 'SELECT id, name, level, manager_id, active FROM users WHERE id = $1', [userId]);
  if (!u) throw notFound('Pessoa não encontrada.');
  const counts = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM users WHERE manager_id = $1 AND active) AS reports,
       (SELECT count(*)::int FROM delegations d WHERE d.delegator_id = $1 AND d.status IN ${OPEN_MADE}) AS delegated,
       (SELECT count(*)::int FROM delegations d JOIN cards c ON c.id = d.card_id WHERE c.owner_id = $1 AND d.status IN ('PENDING_ACCEPT','IN_PROGRESS')) AS received,
       (SELECT count(*)::int FROM delegations d JOIN cards c ON c.id = d.card_id WHERE c.owner_id = $1 AND d.status = 'AWAITING_ACK') AS awaiting,
       (SELECT count(*)::int FROM (${OWN_OPEN}) x) AS own,
       (SELECT count(*)::int FROM cards c WHERE c.owner_id = $1 AND c.archived_at IS NULL AND c.completed_at IS NULL AND c.is_private) AS private`,
    [userId],
  );
  const successors = u.level === null
    ? []
    : await many(
        db,
        `SELECT id, name, role_title, level, CASE WHEN id = $2 THEN 'manager' ELSE 'peer' END AS relation
           FROM users WHERE active AND id <> $1 AND (level = $3 OR id = $2)
          ORDER BY (id = $2) DESC, name`,
        [userId, u.manager_id, u.level],
      );
  const needsSuccessor = counts.reports + counts.delegated + counts.own > 0;
  return { ...counts, needsSuccessor, successors };
}

/**
 * Item 44: desativa a pessoa numa transação só, resolvendo o que está com ela. Nada é apagado e ela pode ser reativada.
 * (a) subordinados passam ao sucessor (como a troca de superior, RN-38 a RN-41); (b) as delegações que ela fez e estão
 * em aberto passam ao sucessor; (c) as tarefas que ela recebeu e não terminou voltam a quem delegou, como devolvidas;
 * (d) as tarefas próprias abertas vão para a caixa de entrada do sucessor; privadas, quadros, concluídas e o log ficam com ela.
 */
export async function deactivate(db: Db, admin: Actor, userId: string, successorId: string | null) {
  const u = await one(db, 'SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (!u) throw notFound('Pessoa não encontrada.');
  if (u.id === admin.id) throw conflict('Você não pode desativar a si mesmo.');
  if (!u.active) throw conflict('Esta pessoa já está inativa.');
  const p = await deactivationPreview(db, userId);
  let succ: { id: string; name: string } | null = null;
  if (p.needsSuccessor) {
    if (!p.successors.length) throw conflict('Não há quem possa receber as pendências desta pessoa. Cadastre antes alguém do mesmo nível.');
    if (!successorId) throw badRequest('Escolha quem recebe as pendências.');
    succ = p.successors.find((s: { id: string; name: string }) => s.id === successorId) ?? null;
    if (!succ) throw badRequest('O sucessor deve ser alguém ativo do mesmo nível ou o superior direto da pessoa.');
  }
  const name = u.name as string;
  const result = { reports: 0, delegated: 0, returned: 0, own: 0 };

  // (a) subordinados: cada um troca de superior, levando junto as delegações em aberto.
  if (succ) {
    const reports = await many(db, 'SELECT id FROM users WHERE manager_id = $1 AND active ORDER BY name', [userId]);
    for (const r of reports) {
      result.delegated += (await transferManagement(db, admin, r.id, succ.id)).moved;
      result.reports++;
    }
    // (b) as demais delegações feitas por ela e ainda em aberto.
    const moved = await many(
      db,
      `UPDATE delegations SET delegator_id = $2, updated_at = now() WHERE delegator_id = $1 AND status IN ${OPEN_MADE} RETURNING card_id`,
      [userId, succ.id],
    );
    for (const r of moved) await logEvent(db, r.card_id, admin.id, 'management_transferred', { delegator: name }, { delegator: succ.name, reason: 'deactivated' });
    result.delegated += moved.length;
  }

  // (c) tarefas recebidas e não terminadas voltam a quem delegou, como devolvidas.
  const reason = `Devolvida porque ${name} foi desativado(a).`;
  const received = await many(
    db,
    `SELECT c.id, c.num, c.title, d.id AS d_id, d.delegator_id FROM delegations d JOIN cards c ON c.id = d.card_id
      WHERE c.owner_id = $1 AND d.status IN ('PENDING_ACCEPT','IN_PROGRESS') FOR UPDATE OF d`,
    [userId],
  );
  for (const r of received) {
    await db.query(`UPDATE delegations SET status = 'DECLINED', decline_reason = $2, updated_at = now() WHERE id = $1`, [r.d_id, reason]);
    await db.query('UPDATE cards SET list_id = NULL, completed_at = NULL, updated_at = now() WHERE id = $1', [r.id]);
    await logEvent(db, r.id, admin.id, 'declined', undefined, { reason, deactivated: name });
    await notify(db, r.delegator_id, 'declined', `Tarefa devolvida: ${name} foi desativado(a). Redelegue ou cancele.`, { id: r.id, num: r.num, title: r.title });
    result.returned++;
  }

  // (d) tarefas próprias abertas vão para a caixa de entrada do sucessor.
  if (succ) {
    const own = await many(db, `${OWN_OPEN} ORDER BY c.seq FOR UPDATE`, [userId]);
    for (const r of own) {
      await db.query('UPDATE cards SET owner_id = $2, list_id = NULL, transferred_from_id = $1, color = NULL, updated_at = now() WHERE id = $3', [userId, succ.id, r.id]);
      await logEvent(db, r.id, admin.id, 'transferred', { owner: name }, { owner: succ.name, reason: 'deactivated' });
    }
    result.own = own.length;
    if (result.own) await notify(db, succ.id, 'transferred', `${name} foi desativado(a): ${result.own} tarefa(s) dele(a) estão na sua caixa de entrada`);
    if (result.delegated && !result.reports) await notify(db, succ.id, 'management', `${name} foi desativado(a): ${result.delegated} delegação(ões) em aberto passaram para você`);
  }

  await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  await db.query('UPDATE users SET active = false, updated_at = now() WHERE id = $1', [userId]);
  return result;
}
