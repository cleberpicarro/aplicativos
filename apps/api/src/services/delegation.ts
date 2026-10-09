import { one, many, type Db } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { isDirectReport, directReports, type Actor } from './actors.js';
import { loadCard, selectCards, nextPosition, cardRef, numOf } from './cards.js';
import { ownList } from './boards.js';
import { logEvent } from './events.js';
import { notify } from './notify.js';

const first = (name: string) => name.split(' ')[0];

/** RN-14 a RN-19: delega a partir de uma tarefa existente, criando um cartão ligado para o subordinado direto. */
export async function delegate(db: Db, actor: Actor, cardId: string, input: { toUserId: string; suggestedDue?: string | null; note?: string }) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden('Só quem tem a tarefa pode delegá-la.');
  if (row.archived_at || row.completed_at) throw conflict('Tarefa concluída ou arquivada não pode ser delegada.');
  if (!row.list_id) throw conflict('Organize a tarefa pela caixa de entrada antes de delegá-la.');
  if (row.child_delegation_id && !['ACKED', 'CANCELED'].includes(row.child_status)) {
    throw conflict('Esta tarefa já tem uma delegação em aberto.');
  }
  if (!(await isDirectReport(db, actor.id, input.toUserId))) {
    throw forbidden('Você só pode delegar para um subordinado direto.');
  }
  const due = input.suggestedDue === undefined ? row.due_date : input.suggestedDue;
  const child = await one(
    db,
    `INSERT INTO cards (owner_id, list_id, title, description, due_date, created_by)
     VALUES ($1, NULL, $2, $3, $4, $5) RETURNING id, code, num, title`,
    [input.toUserId, row.title, row.description, due, actor.id],
  );
  const del = await one(
    db,
    `INSERT INTO delegations (card_id, parent_card_id, delegator_id, status, suggested_due)
     VALUES ($1, $2, $3, 'PENDING_ACCEPT', $4) RETURNING id`,
    [child.id, row.id, actor.id, due],
  );
  const to = await one(db, 'SELECT name FROM users WHERE id = $1', [input.toUserId]);
  await logEvent(db, child.id, actor.id, 'delegated', undefined, { from: actor.name, to: to.name, suggestedDue: due, parentNum: row.num });
  await logEvent(db, row.id, actor.id, 'delegated_down', undefined, { to: to.name, childNum: child.num });
  if (input.note?.trim()) {
    await db.query('INSERT INTO comments (card_id, author_id, body) VALUES ($1, $2, $3)', [child.id, actor.id, input.note.trim()]);
    await logEvent(db, child.id, actor.id, 'comment_added', undefined, { body: input.note.trim() });
  }
  await notify(db, input.toUserId, 'delegated', `${first(actor.name)} delegou: ${row.title}`, cardRef(child));
  return { cardId: child.id, code: child.code, num: child.num, delegationId: del.id };
}

export async function inbox(db: Db, actor: Actor) {
  return selectCards(
    db,
    `c.owner_id = $1 AND c.list_id IS NULL AND c.archived_at IS NULL AND (d.id IS NULL OR d.status = 'PENDING_ACCEPT')`,
    [actor.id],
    'c.updated_at DESC',
  );
}

export async function accept(db: Db, actor: Actor, cardId: string, listId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner' || row.list_id || row.archived_at) throw conflict('Esta tarefa não está na sua caixa de entrada.');
  if (row.d_id && row.d_status !== 'PENDING_ACCEPT') throw conflict('Esta tarefa não está na sua caixa de entrada.');
  const list = await ownList(db, actor, listId);
  const pos = await nextPosition(db, 'SELECT max(position) AS max FROM cards WHERE list_id = $1', [listId]);
  await db.query('UPDATE cards SET list_id = $2, position = $3, updated_at = now() WHERE id = $1', [cardId, listId, pos]);
  if (row.d_id) await db.query(`UPDATE delegations SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1`, [row.d_id]);
  const board = await one(db, 'SELECT name FROM boards WHERE id = $1', [list.board_id]);
  await logEvent(db, cardId, actor.id, 'accepted', undefined, { board: board.name, list: list.name, num: await numOf(db, cardId) });
}

/** RN-23: devolver exige justificativa; a tarefa volta ao delegador. */
export async function decline(db: Db, actor: Actor, cardId: string, reason: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner' || !row.d_id) throw conflict('Só é possível devolver uma tarefa recebida por delegação.');
  if (row.transferred_from_id) throw conflict('Tarefa transferida não pode ser devolvida. Você pode transferi-la novamente.');
  if (!['PENDING_ACCEPT', 'IN_PROGRESS'].includes(row.d_status)) throw conflict('Esta tarefa não pode ser devolvida agora.');
  const r = (reason ?? '').trim();
  if (r.length < 3) throw badRequest('A justificativa é obrigatória.');
  await db.query(
    `UPDATE delegations SET status = 'DECLINED', decline_reason = $2, updated_at = now() WHERE id = $1`,
    [row.d_id, r],
  );
  await db.query('UPDATE cards SET list_id = NULL, completed_at = NULL, updated_at = now() WHERE id = $1', [cardId]);
  await logEvent(db, cardId, actor.id, 'declined', undefined, { reason: r });
  await notify(db, row.d_delegator_id, 'declined', `${first(actor.name)} devolveu a tarefa: ${r}`, cardRef(row));
}

async function delegatorDelegation(db: Db, actor: Actor, delegationId: string) {
  const d = await one(db, 'SELECT * FROM delegations WHERE id = $1 FOR UPDATE', [delegationId]);
  if (!d || d.delegator_id !== actor.id) throw notFound('Delegação não encontrada.');
  const card = await one(db, 'SELECT id, code, num, title, owner_id, due_date FROM cards WHERE id = $1', [d.card_id]);
  return { d, card };
}

export async function ack(db: Db, actor: Actor, delegationId: string) {
  const { d, card } = await delegatorDelegation(db, actor, delegationId);
  if (d.status !== 'AWAITING_ACK') throw conflict('Só é possível dar ciente em tarefa concluída.');
  await db.query(`UPDATE delegations SET status = 'ACKED', acked_at = now(), updated_at = now() WHERE id = $1`, [d.id]);
  await db.query('UPDATE cards SET archived_at = now(), updated_at = now() WHERE id = $1', [card.id]);
  await logEvent(db, card.id, actor.id, 'acked');
  await notify(db, card.owner_id, 'acked', `${first(actor.name)} deu ciente: tarefa arquivada`, cardRef(card));
}

export async function reopen(db: Db, actor: Actor, delegationId: string, comment: string) {
  const { d, card } = await delegatorDelegation(db, actor, delegationId);
  if (d.status !== 'AWAITING_ACK') throw conflict('Só é possível reabrir tarefa concluída aguardando ciente.');
  const c = (comment ?? '').trim();
  if (c.length < 3) throw badRequest('Explique o motivo da reabertura.');
  await db.query(`UPDATE delegations SET status = 'IN_PROGRESS', reopened = true, updated_at = now() WHERE id = $1`, [d.id]);
  await db.query('UPDATE cards SET completed_at = NULL, updated_at = now() WHERE id = $1', [card.id]);
  await db.query('INSERT INTO comments (card_id, author_id, body) VALUES ($1, $2, $3)', [card.id, actor.id, c]);
  await logEvent(db, card.id, actor.id, 'reopened', undefined, { reason: c });
  await notify(db, card.owner_id, 'reopened', `${first(actor.name)} reabriu a tarefa: ${c}`, cardRef(card));
}

export async function cancel(db: Db, actor: Actor, delegationId: string) {
  const { d, card } = await delegatorDelegation(db, actor, delegationId);
  if (!['PENDING_ACCEPT', 'IN_PROGRESS', 'DECLINED'].includes(d.status)) throw conflict('Esta delegação não pode ser cancelada.');
  await db.query(`UPDATE delegations SET status = 'CANCELED', canceled_at = now(), updated_at = now() WHERE id = $1`, [d.id]);
  await db.query('UPDATE cards SET archived_at = now(), list_id = NULL, updated_at = now() WHERE id = $1', [card.id]);
  await logEvent(db, card.id, actor.id, 'canceled');
  if (d.parent_card_id) await logEvent(db, d.parent_card_id, actor.id, 'child_canceled', undefined, { childNum: card.num });
  await notify(db, card.owner_id, 'canceled', `${first(actor.name)} cancelou a delegação`, cardRef(card));
}

/** RN-29: redelegar tarefa devolvida mantém o código. */
export async function redelegate(db: Db, actor: Actor, delegationId: string, input: { toUserId: string; suggestedDue?: string | null }) {
  const { d, card } = await delegatorDelegation(db, actor, delegationId);
  if (d.status !== 'DECLINED') throw conflict('Só é possível redelegar uma tarefa devolvida.');
  if (!(await isDirectReport(db, actor.id, input.toUserId))) throw forbidden('Você só pode delegar para um subordinado direto.');
  const due = input.suggestedDue === undefined ? card.due_date : input.suggestedDue;
  await db.query(
    `UPDATE delegations SET status = 'PENDING_ACCEPT', decline_reason = NULL, reopened = false, suggested_due = $2, updated_at = now() WHERE id = $1`,
    [d.id, due],
  );
  await db.query(
    `UPDATE cards SET owner_id = $2, list_id = NULL, transferred_from_id = NULL, completed_at = NULL, due_date = $3, color = NULL, updated_at = now() WHERE id = $1`,
    [card.id, input.toUserId, due],
  );
  const to = await one(db, 'SELECT name FROM users WHERE id = $1', [input.toUserId]);
  await logEvent(db, card.id, actor.id, 'redelegated', undefined, { to: to.name, suggestedDue: due });
  await notify(db, input.toUserId, 'delegated', `${first(actor.name)} delegou: ${card.title}`, { ...cardRef(card), num: await numOf(db, card.id) });
}

/** Destinos de transferência: subordinados diretos, colegas do mesmo nível com o mesmo superior e o superior direto. */
export async function transferTargets(db: Db, actor: Actor, delegatorId: string | null) {
  const rows = await many(
    db,
    `SELECT id, name, role_title, 'subordinate' AS relation FROM users WHERE manager_id = $1 AND active
     UNION ALL
     SELECT id, name, role_title, 'peer' FROM users WHERE $2::uuid IS NOT NULL AND manager_id = $2 AND level IS NOT DISTINCT FROM $3 AND id <> $1 AND active
     UNION ALL
     SELECT id, name, role_title, 'manager' FROM users WHERE id = $2 AND active`,
    [actor.id, actor.managerId, actor.level],
  );
  return rows.filter((r) => r.id !== delegatorId);
}

export async function transfer(db: Db, actor: Actor, cardId: string, toUserId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden('Só quem tem a tarefa pode transferi-la.');
  if (row.archived_at || row.completed_at) throw conflict('Tarefa concluída ou arquivada não pode ser transferida.');
  if (row.child_delegation_id && !['ACKED', 'CANCELED'].includes(row.child_status)) {
    throw conflict('Esta tarefa tem uma delegação em aberto. Cancele a delegação ou aguarde o ciente antes de transferir.');
  }
  const targets = await transferTargets(db, actor, row.d_delegator_id ?? null);
  if (!targets.some((t) => t.id === toUserId)) {
    throw forbidden('Você pode transferir apenas para um subordinado direto, um colega do mesmo nível ou seu superior direto.');
  }
  await db.query(
    'UPDATE cards SET owner_id = $2, list_id = NULL, transferred_from_id = $3, color = NULL, updated_at = now() WHERE id = $1',
    [cardId, toUserId, actor.id],
  );
  if (row.d_id && row.d_status === 'IN_PROGRESS') {
    await db.query(`UPDATE delegations SET status = 'PENDING_ACCEPT', updated_at = now() WHERE id = $1`, [row.d_id]);
  }
  const to = await one(db, 'SELECT name FROM users WHERE id = $1', [toUserId]);
  await logEvent(db, cardId, actor.id, 'transferred', { owner: actor.name }, { owner: to.name });
  await notify(db, toUserId, 'transferred', `${first(actor.name)} transferiu uma tarefa para você: ${row.title}`, { ...cardRef(row), num: await numOf(db, cardId) });
}

/** Tela Tarefas delegadas: o que precisa de ação e um grupo por pessoa, com contadores (RN-34, RN-35). */
export async function delegationsOverview(db: Db, actor: Actor, includeArchived: boolean) {
  const cards = await selectCards(
    db,
    `d.delegator_id = $1 ${includeArchived ? '' : 'AND c.archived_at IS NULL'}`,
    [actor.id],
    'c.due_date NULLS LAST, c.seq',
  );
  const reports = await directReports(db, actor.id);
  const people = new Map<string, { id: string; name: string; roleTitle: string; direct: boolean }>();
  for (const r of reports) people.set(r.id, { id: r.id, name: r.name, roleTitle: r.role_title, direct: true });
  for (const c of cards) {
    if (!people.has(c.ownerId)) {
      const u = await one(db, 'SELECT id, name, role_title FROM users WHERE id = $1', [c.ownerId]);
      people.set(u.id, { id: u.id, name: u.name, roleTitle: u.role_title, direct: false });
    }
  }
  const ids = [...people.keys()];
  const ownCounts = ids.length
    ? await many(
        db,
        `SELECT c.owner_id, count(*)::int AS n FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
          WHERE c.owner_id = ANY($1::uuid[]) AND d.id IS NULL AND c.archived_at IS NULL AND c.completed_at IS NULL AND NOT c.is_private
          GROUP BY c.owner_id`,
        [ids],
      )
    : [];
  const own = new Map(ownCounts.map((r) => [r.owner_id, r.n]));
  const today = (await one(db, `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d`))!.d as string;

  const groups = [...people.values()].map((p) => {
    const tasks = cards.filter((c) => c.ownerId === p.id);
    const active = tasks.filter((c) => !c.archivedAt);
    const open = active.filter((c) => ['PENDING_ACCEPT', 'IN_PROGRESS'].includes(c.delegation!.status));
    return {
      person: p,
      counts: {
        open: open.length,
        late: open.filter((c) => c.dueDate && c.dueDate < today).length,
        awaitingAck: active.filter((c) => c.delegation!.status === 'AWAITING_ACK').length,
        declined: active.filter((c) => c.delegation!.status === 'DECLINED').length,
        own: own.get(p.id) ?? 0,
      },
      tasks,
    };
  });
  const needAction = cards.filter((c) => !c.archivedAt && ['AWAITING_ACK', 'DECLINED'].includes(c.delegation!.status));
  return { today, needAction, groups: groups.filter((g) => g.person.direct || g.tasks.length) };
}
