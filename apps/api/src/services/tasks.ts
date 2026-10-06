import { one, many, type Db } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { loadCard, nextPosition, cardRef } from './cards.js';
import { ownList } from './boards.js';
import { logEvent } from './events.js';
import { notify } from './notify.js';

const OPEN = ['PENDING_ACCEPT', 'IN_PROGRESS', 'AWAITING_ACK'];

function fmtDate(d: string | null) {
  if (!d) return 'sem prazo';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export async function createCard(db: Db, actor: Actor, listId: string, title: string) {
  const clean = title.trim();
  if (!clean) throw badRequest('Informe o título da tarefa.');
  await ownList(db, actor, listId);
  const position = await nextPosition(db, 'SELECT max(position) AS max FROM cards WHERE list_id = $1', [listId]);
  const c = await one(
    db,
    `INSERT INTO cards (owner_id, list_id, position, title, created_by) VALUES ($1, $2, $3, $4, $1) RETURNING id, code, title`,
    [actor.id, listId, position, clean],
  );
  await logEvent(db, c.id, actor.id, 'created', undefined, { title: clean });
  return c;
}

export interface CardPatch {
  title?: string;
  description?: string;
  dueDate?: string | null;
  isPrivate?: boolean;
}

export async function updateCard(db: Db, actor: Actor, cardId: string, patch: CardPatch) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden('Só quem tem a tarefa pode editá-la.');
  if (row.archived_at) throw conflict('Tarefa arquivada não pode ser editada.');

  if (patch.title !== undefined && patch.title.trim() !== row.title) {
    const t = patch.title.trim();
    if (!t) throw badRequest('O título não pode ficar vazio.');
    await db.query('UPDATE cards SET title = $2, updated_at = now() WHERE id = $1', [cardId, t]);
    await logEvent(db, cardId, actor.id, 'title_changed', { title: row.title }, { title: t });
  }
  if (patch.description !== undefined && patch.description !== row.description) {
    await db.query('UPDATE cards SET description = $2, updated_at = now() WHERE id = $1', [cardId, patch.description]);
    await logEvent(db, cardId, actor.id, 'description_changed', { description: row.description }, { description: patch.description });
  }
  if (patch.dueDate !== undefined && patch.dueDate !== row.due_date) {
    await db.query('UPDATE cards SET due_date = $2, updated_at = now() WHERE id = $1', [cardId, patch.dueDate]);
    await logEvent(db, cardId, actor.id, 'due_changed', { dueDate: row.due_date }, { dueDate: patch.dueDate });
    if (row.d_id && OPEN.includes(row.d_status)) {
      await notify(db, row.d_delegator_id, 'due_changed', `${actor.name.split(' ')[0]} alterou o prazo para ${fmtDate(patch.dueDate)} (antes ${fmtDate(row.due_date)})`, cardRef(row));
    }
  }
  if (patch.isPrivate !== undefined && patch.isPrivate !== row.is_private) {
    if (row.d_id && patch.isPrivate) throw conflict('Uma tarefa recebida por delegação não pode ser privada.');
    await db.query('UPDATE cards SET is_private = $2, updated_at = now() WHERE id = $1', [cardId, patch.isPrivate]);
    await logEvent(db, cardId, actor.id, 'privacy_changed', { isPrivate: row.is_private }, { isPrivate: patch.isPrivate });
  }
}

/**
 * Move a tarefa para uma fase de qualquer quadro da pessoa (item 16).
 * `place` coloca no topo ou no fim da fase (item 10); `position` é usada pelo arrastar.
 */
export async function moveCard(db: Db, actor: Actor, cardId: string, listId: string, position?: number, place?: 'top' | 'end') {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden();
  if (row.archived_at) throw conflict('Tarefa arquivada não pode ser movida.');
  if (!row.list_id) throw conflict('Organize a tarefa pela caixa de entrada primeiro.');
  const list = await ownList(db, actor, listId);
  let pos = position;
  if (pos === undefined) {
    const r = await one<{ min: number | null; max: number | null }>(
      db, 'SELECT min(position) AS min, max(position) AS max FROM cards WHERE list_id = $1 AND id <> $2 AND archived_at IS NULL', [listId, cardId],
    );
    pos = place === 'top' ? (r?.min ?? 1) - 1 : (r?.max ?? 0) + 1;
  }
  await db.query('UPDATE cards SET list_id = $2, position = $3, updated_at = now() WHERE id = $1', [cardId, listId, pos]);
  if (row.list_id !== listId) {
    const from = await one(db, 'SELECT l.name AS list, b.name AS board, b.id AS board_id FROM lists l JOIN boards b ON b.id = l.board_id WHERE l.id = $1', [row.list_id]);
    const to = await one(db, 'SELECT name FROM boards WHERE id = $1', [list.board_id]);
    const otherBoard = from && from.board_id !== list.board_id;
    await logEvent(db, cardId, actor.id, 'moved',
      otherBoard ? { board: from.board, list: from.list } : { list: from?.list ?? null },
      otherBoard ? { board: to.name, list: list.name } : { list: list.name });
  }
}

export async function completeCard(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden();
  if (row.archived_at) throw conflict('Tarefa arquivada.');
  if (row.completed_at) throw conflict('A tarefa já está concluída.');
  if (row.d_id) {
    if (row.d_status !== 'IN_PROGRESS') throw conflict('Aceite a tarefa na caixa de entrada antes de concluí-la.');
    await db.query(`UPDATE delegations SET status = 'AWAITING_ACK', reopened = false, updated_at = now() WHERE id = $1`, [row.d_id]);
    await notify(db, row.d_delegator_id, 'completed', `${actor.name.split(' ')[0]} concluiu a tarefa: aguardando seu ciente`, cardRef(row));
  } else if (!row.list_id) {
    throw conflict('Organize a tarefa pela caixa de entrada primeiro.');
  }
  await db.query('UPDATE cards SET completed_at = now(), updated_at = now() WHERE id = $1', [cardId]);
  await logEvent(db, cardId, actor.id, 'completed');
}

export async function uncompleteCard(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden();
  if (row.archived_at) throw conflict('Tarefa arquivada.');
  if (!row.completed_at) throw conflict('A tarefa não está concluída.');
  if (row.d_id) {
    if (row.d_status !== 'AWAITING_ACK') throw conflict('Não é possível desfazer a conclusão agora.');
    await db.query(`UPDATE delegations SET status = 'IN_PROGRESS', updated_at = now() WHERE id = $1`, [row.d_id]);
  }
  await db.query('UPDATE cards SET completed_at = NULL, updated_at = now() WHERE id = $1', [cardId]);
  await logEvent(db, cardId, actor.id, 'completion_undone');
}

/* ---------- arquivar tarefa concluída (item 23) ---------- */

const CHILD_OPEN = `SELECT 1 FROM delegations WHERE parent_card_id = $1 AND status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED')`;

/** Só tarefa própria: a recebida por delegação é arquivada por quem delegou, ao dar o ciente. */
function assertArchivable(row: any, role: string) {
  if (role !== 'owner') throw forbidden();
  if (row.d_id) throw conflict('Quem arquiva esta tarefa é quem a delegou, ao dar o ciente.');
}

export async function archiveCard(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  assertArchivable(row, role);
  if (row.archived_at) throw conflict('A tarefa já está arquivada.');
  if (!row.completed_at) throw conflict('Conclua a tarefa antes de arquivá-la.');
  if (await one(db, CHILD_OPEN, [cardId])) throw conflict('Esta tarefa tem uma delegação em aberto. Dê o ciente ou cancele a delegação antes de arquivar.');
  await db.query('UPDATE cards SET archived_at = now(), updated_at = now() WHERE id = $1', [cardId]);
  await logEvent(db, cardId, actor.id, 'archived');
}

export async function unarchiveCard(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  assertArchivable(row, role);
  if (!row.archived_at) throw conflict('A tarefa não está arquivada.');
  // Volta para a mesma fase; se ela foi arquivada, para a primeira fase do mesmo quadro (ou do primeiro quadro).
  const target = await one<{ id: string }>(
    db,
    `SELECT l.id FROM lists l JOIN boards b ON b.id = l.board_id
      WHERE b.owner_id = $2 AND l.archived_at IS NULL AND b.archived_at IS NULL
      ORDER BY coalesce(l.id = $1, false) DESC, coalesce(l.board_id = (SELECT board_id FROM lists WHERE id = $1), false) DESC, b.position, l.position LIMIT 1`,
    [row.list_id, actor.id],
  );
  if (!target) throw conflict('Crie um quadro antes de desarquivar a tarefa.');
  // Na mesma fase, volta ao lugar onde estava (o "Desfazer" fica exato); em outra, entra no fim.
  const position = target.id === row.list_id
    ? row.position
    : await nextPosition(db, 'SELECT max(position) AS max FROM cards WHERE list_id = $1 AND archived_at IS NULL', [target.id]);
  await db.query('UPDATE cards SET archived_at = NULL, list_id = $2, position = $3, updated_at = now() WHERE id = $1', [cardId, target.id, position]);
  await logEvent(db, cardId, actor.id, 'unarchived');
}

/** Menu da fase: arquiva de uma vez as tarefas concluídas que a pessoa pode arquivar. */
export async function archiveDoneInList(db: Db, actor: Actor, listId: string) {
  await ownList(db, actor, listId);
  const rows = await many<{ id: string }>(
    db,
    `SELECT c.id FROM cards c
      WHERE c.list_id = $1 AND c.owner_id = $2 AND c.archived_at IS NULL AND c.completed_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM delegations d WHERE d.card_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM delegations x WHERE x.parent_card_id = c.id AND x.status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED'))
      FOR UPDATE`,
    [listId, actor.id],
  );
  for (const r of rows) {
    await db.query('UPDATE cards SET archived_at = now(), updated_at = now() WHERE id = $1', [r.id]);
    await logEvent(db, r.id, actor.id, 'archived');
  }
  return { archived: rows.length, ids: rows.map((r) => r.id) };
}

/* ---------- checklist (só quem tem a tarefa edita) ---------- */

async function ownerOpenCard(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden('Só quem tem a tarefa edita o checklist.');
  if (row.archived_at) throw conflict('Tarefa arquivada.');
  return row;
}

export async function addChecklistItem(db: Db, actor: Actor, cardId: string, text: string) {
  await ownerOpenCard(db, actor, cardId);
  const t = text.trim();
  if (!t) throw badRequest('Escreva o item.');
  const position = await nextPosition(db, 'SELECT max(position) AS max FROM checklist_items WHERE card_id = $1', [cardId]);
  const item = await one(db, 'INSERT INTO checklist_items (card_id, text, position) VALUES ($1, $2, $3) RETURNING id, text, done, position', [cardId, t, position]);
  await logEvent(db, cardId, actor.id, 'checklist_added', undefined, { text: t });
  return item;
}

export async function updateChecklistItem(db: Db, actor: Actor, cardId: string, itemId: string, patch: { text?: string; done?: boolean }) {
  await ownerOpenCard(db, actor, cardId);
  const item = await one(db, 'SELECT * FROM checklist_items WHERE id = $1 AND card_id = $2', [itemId, cardId]);
  if (!item) throw notFound('Item não encontrado.');
  if (patch.text !== undefined && patch.text.trim() !== item.text) {
    if (!patch.text.trim()) throw badRequest('O item não pode ficar vazio.');
    await db.query('UPDATE checklist_items SET text = $2, updated_at = now() WHERE id = $1', [itemId, patch.text.trim()]);
    await logEvent(db, cardId, actor.id, 'checklist_edited', { text: item.text }, { text: patch.text.trim() });
  }
  if (patch.done !== undefined && patch.done !== item.done) {
    await db.query('UPDATE checklist_items SET done = $2, updated_at = now() WHERE id = $1', [itemId, patch.done]);
    await logEvent(db, cardId, actor.id, patch.done ? 'checklist_checked' : 'checklist_unchecked', undefined, { text: item.text });
  }
}

export async function deleteChecklistItem(db: Db, actor: Actor, cardId: string, itemId: string) {
  await ownerOpenCard(db, actor, cardId);
  const item = await one(db, 'DELETE FROM checklist_items WHERE id = $1 AND card_id = $2 RETURNING text', [itemId, cardId]);
  if (!item) throw notFound('Item não encontrado.');
  await logEvent(db, cardId, actor.id, 'checklist_removed', { text: item.text });
}

/* ---------- comentários (dono e delegador; não editáveis) ---------- */

export async function addComment(db: Db, actor: Actor, cardId: string, body: string) {
  const { row, role } = await loadCard(db, actor, cardId);
  if (role === 'auditor') throw forbidden('Só quem tem a tarefa ou quem a delegou pode comentar.');
  if (row.archived_at) throw conflict('Tarefa arquivada não recebe comentários.');
  const b = body.trim();
  if (!b) throw badRequest('Escreva o comentário.');
  const c = await one(db, 'INSERT INTO comments (card_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at', [cardId, actor.id, b]);
  await logEvent(db, cardId, actor.id, 'comment_added', undefined, { body: b });
  return c;
}

export async function cardEvents(db: Db, cardId: string) {
  return many(
    db,
    `SELECT e.id, e.type, e.before, e.after, e.created_at, u.name AS actor_name
       FROM card_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.card_id = $1 ORDER BY e.created_at, e.id`,
    [cardId],
  );
}
