import { one, many, type Db } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { selectCards, nextPosition } from './cards.js';

export const DEFAULT_LISTS = ['A fazer', 'Fazendo', 'Feito'];

/** Cores de fundo disponíveis para um quadro (item 12). Os tons de cada uma ficam no front-end. */
export const BOARD_COLORS = ['azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'rosa', 'cinza'] as const;

export async function createBoard(db: Db, ownerId: string, name: string) {
  const clean = name.trim();
  if (!clean) throw badRequest('Dê um nome ao quadro.');
  const position = await nextPosition(db, 'SELECT max(position) AS max FROM boards WHERE owner_id = $1', [ownerId]);
  const board = await one(db, 'INSERT INTO boards (owner_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position', [ownerId, clean, position]);
  for (let i = 0; i < DEFAULT_LISTS.length; i++) {
    await db.query('INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3)', [board.id, DEFAULT_LISTS[i], i + 1]);
  }
  return board;
}

async function ownBoard(db: Db, actor: Actor, boardId: string) {
  const b = await one(db, 'SELECT * FROM boards WHERE id = $1 AND owner_id = $2 AND archived_at IS NULL', [boardId, actor.id]);
  if (!b) throw notFound('Quadro não encontrado.');
  return b;
}

export async function ownList(db: Db, actor: Actor, listId: string) {
  const l = await one(
    db,
    `SELECT l.* FROM lists l JOIN boards b ON b.id = l.board_id
      WHERE l.id = $1 AND b.owner_id = $2 AND l.archived_at IS NULL AND b.archived_at IS NULL`,
    [listId, actor.id],
  );
  if (!l) throw notFound('Fase não encontrada.');
  return l;
}

export async function listBoards(db: Db, actor: Actor) {
  return many(db, 'SELECT id, name, position, color FROM boards WHERE owner_id = $1 AND archived_at IS NULL ORDER BY position', [actor.id]);
}

export async function boardDetail(db: Db, actor: Actor, boardId: string) {
  const board = await ownBoard(db, actor, boardId);
  const lists = await many(db, 'SELECT id, name, position FROM lists WHERE board_id = $1 AND archived_at IS NULL ORDER BY position', [boardId]);
  // Cartões visíveis ao dono: não arquivados e sem delegação devolvida/cancelada.
  const cards = await selectCards(
    db,
    `l.board_id = $1 AND c.owner_id = $2 AND c.archived_at IS NULL AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))`,
    [boardId, actor.id],
  );
  return { id: board.id, name: board.name, color: board.color, lists, cards };
}

export async function renameBoard(db: Db, actor: Actor, boardId: string, name: string) {
  await ownBoard(db, actor, boardId);
  if (!name.trim()) throw badRequest('Dê um nome ao quadro.');
  await db.query('UPDATE boards SET name = $2 WHERE id = $1', [boardId, name.trim()]);
}

/** Item 26: muda a ordem dos quadros (arrastar a aba ou mover pelo menu). */
export async function moveBoard(db: Db, actor: Actor, boardId: string, position: number) {
  await ownBoard(db, actor, boardId);
  await db.query('UPDATE boards SET position = $2 WHERE id = $1', [boardId, position]);
}

export async function setBoardColor(db: Db, actor: Actor, boardId: string, color: string | null) {
  await ownBoard(db, actor, boardId);
  if (color !== null && !(BOARD_COLORS as readonly string[]).includes(color)) throw badRequest('Cor inválida.');
  await db.query('UPDATE boards SET color = $2 WHERE id = $1', [boardId, color]);
}

/** Item 11: reorganiza a fase de uma vez. Depois disso, o arrastar continua valendo. */
export async function sortList(db: Db, actor: Actor, listId: string, by: 'title' | 'created' | 'due') {
  await ownList(db, actor, listId);
  const order = {
    title: 'lower(c.title), c.seq',
    created: 'c.created_at, c.seq',
    due: 'c.due_date NULLS LAST, c.seq',
  }[by];
  await db.query(
    `UPDATE cards SET position = o.n FROM (
       SELECT c.id, row_number() OVER (ORDER BY ${order}) AS n FROM cards c WHERE c.list_id = $1 AND c.archived_at IS NULL
     ) o WHERE cards.id = o.id`,
    [listId],
  );
}

export async function createList(db: Db, actor: Actor, boardId: string, name: string) {
  await ownBoard(db, actor, boardId);
  if (!name.trim()) throw badRequest('Dê um nome à fase.');
  const position = await nextPosition(db, 'SELECT max(position) AS max FROM lists WHERE board_id = $1', [boardId]);
  return one(db, 'INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3) RETURNING id, name, position', [boardId, name.trim(), position]);
}

export async function updateList(db: Db, actor: Actor, listId: string, patch: { name?: string; position?: number }) {
  await ownList(db, actor, listId);
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw badRequest('Dê um nome à fase.');
    await db.query('UPDATE lists SET name = $2 WHERE id = $1', [listId, patch.name.trim()]);
  }
  if (patch.position !== undefined) await db.query('UPDATE lists SET position = $2 WHERE id = $1', [listId, patch.position]);
}

/** RN-03: só arquiva fase vazia. */
export async function archiveList(db: Db, actor: Actor, listId: string) {
  await ownList(db, actor, listId);
  const r = await one(db, 'SELECT count(*)::int AS n FROM cards WHERE list_id = $1 AND archived_at IS NULL', [listId]);
  if (r!.n > 0) throw conflict('Esta fase ainda tem tarefas. Mova as tarefas para outra fase antes de arquivá-la.');
  await db.query('UPDATE lists SET archived_at = now() WHERE id = $1', [listId]);
}
