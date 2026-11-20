/**
 * Item 85: fase expandida. A ordem da fase é a prioridade da pessoa (1º, 2º…): o campo Prioridade da tarefa
 * aberta muda a posição dela, e as ações em massa da fase expandida mexem em várias tarefas de uma vez.
 */
import { one, type Db } from '../lib/db.js';
import { badRequest, conflict, forbidden, HttpError } from '../lib/errors.js';
import { subWhere, type Actor } from './actors.js';
import { loadCard, selectCards } from './cards.js';
import { ownList } from './boards.js';
import { logEvent } from './events.js';
import * as tasks from './tasks.js';

/** As tarefas que aparecem na fase, na ordem do quadro (a mesma regra do quadro). */
async function visibleInList(db: Db, actor: Actor, listId: string) {
  return selectCards(
    db,
    `c.list_id = $1 AND c.owner_id = $2 AND c.archived_at IS NULL AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))${subWhere(actor)}`,
    [listId, actor.id],
  );
}

/** Prioridade da tarefa na fase dela: "5º de 91 em A fazer". Só para quem tem a tarefa e só se ela está num quadro. */
export async function priorityOf(db: Db, actor: Actor, row: { id: string; list_id: string | null; archived_at: unknown }) {
  if (!row.list_id || row.archived_at) return null;
  const cards = await visibleInList(db, actor, row.list_id);
  const i = cards.findIndex((c) => c.id === row.id);
  if (i < 0) return null;
  const l = await one<{ name: string }>(db, 'SELECT name FROM lists WHERE id = $1', [row.list_id]);
  return { listId: row.list_id, listName: l!.name, rank: i + 1, total: cards.length };
}

/** Campo Prioridade: põe a tarefa na posição `rank` (1 = topo) da própria fase. Fica no log. */
export async function setPriority(db: Db, actor: Actor, cardId: string, rank: number) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role !== 'owner') throw forbidden('Só quem tem a tarefa muda a prioridade dela.');
  if (row.archived_at) throw conflict('Tarefa arquivada não tem prioridade.');
  if (!row.list_id) throw conflict('Organize a tarefa pela caixa de entrada primeiro.');
  await db.query('SELECT 1 FROM lists WHERE id = $1 FOR UPDATE', [row.list_id]);
  const all = await visibleInList(db, actor, row.list_id);
  const before = all.findIndex((c) => c.id === cardId) + 1;
  const others = all.filter((c) => c.id !== cardId);
  const target = Math.min(Math.max(1, Math.round(rank)), others.length + 1);
  if (target === before) return { rank: before, total: all.length };
  const prev = others[target - 2];
  const next = others[target - 1];
  const pos = prev && next ? (prev.position + next.position) / 2 : next ? next.position - 1 : prev ? prev.position + 1 : 1;
  await db.query('UPDATE cards SET position = $2, updated_at = now() WHERE id = $1', [cardId, pos]);
  await logEvent(db, cardId, actor.id, 'priority_changed', { rank: before }, { rank: target, total: all.length });
  return { rank: target, total: all.length };
}

/* ---------- ações em massa ---------- */

export const MAX_BULK = 1000;

export type BulkInput =
  | { action: 'complete' | 'uncomplete' | 'archive' | 'unarchive' | 'discard'; ids: string[] }
  | { action: 'move'; ids: string[]; listId: string; place: 'top' | 'end' }
  | { action: 'place'; items: { id: string; listId: string; position: number }[] }
  | { action: 'due'; items: { id: string; dueDate: string | null }[] }
  | { action: 'color'; items: { id: string; color: string | null }[] };

export interface BulkResult {
  done: string[];
  skipped: { id: string; title: string; reason: string }[];
}

/**
 * Faz a mesma ação em várias tarefas da pessoa. Todas precisam ser dela (senão nada acontece);
 * as que a regra não deixa (ex.: descartar uma tarefa recebida por delegação) são puladas, com o motivo.
 * Delegar e transferir não existem aqui: continuam uma tarefa por vez.
 */
export async function bulk(db: Db, actor: Actor, input: BulkInput): Promise<BulkResult> {
  const ids = 'ids' in input ? input.ids : input.items.map((i) => i.id);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) throw badRequest('Tarefa repetida na lista.');
  const titles = new Map<string, string>();
  for (const id of unique) {
    const { row, role } = await loadCard(db, actor, id, { lock: true });
    if (role !== 'owner') throw forbidden('Só quem tem as tarefas pode mexer nelas.');
    titles.set(id, row.title);
  }
  // Destinos também precisam ser fases da pessoa.
  const lists = input.action === 'move' ? [input.listId] : input.action === 'place' ? [...new Set(input.items.map((i) => i.listId))] : [];
  for (const l of lists) await ownList(db, actor, l);

  const result: BulkResult = { done: [], skipped: [] };
  const each = async (id: string, fn: () => Promise<unknown>) => {
    await db.query('SAVEPOINT bulk_item');
    try {
      await fn();
      await db.query('RELEASE SAVEPOINT bulk_item');
      result.done.push(id);
    } catch (err) {
      await db.query('ROLLBACK TO SAVEPOINT bulk_item');
      if (!(err instanceof HttpError)) throw err;
      result.skipped.push({ id, title: titles.get(id)!, reason: err.message });
    }
  };

  switch (input.action) {
    case 'complete': for (const id of unique) await each(id, () => tasks.completeCard(db, actor, id)); break;
    case 'uncomplete': for (const id of unique) await each(id, () => tasks.uncompleteCard(db, actor, id)); break;
    case 'archive': for (const id of unique) await each(id, () => tasks.archiveCard(db, actor, id)); break;
    case 'unarchive': for (const id of unique) await each(id, () => tasks.unarchiveCard(db, actor, id)); break;
    case 'discard': for (const id of unique) await each(id, () => tasks.discardCard(db, actor, id)); break;
    case 'move': {
      // Entram juntas, na ordem enviada, no topo ou no fim da fase de destino.
      const r = await one<{ min: number | null; max: number | null }>(
        db,
        'SELECT min(position) AS min, max(position) AS max FROM cards WHERE list_id = $1 AND archived_at IS NULL AND NOT (id = ANY($2::uuid[]))',
        [input.listId, unique],
      );
      const start = input.place === 'top' ? (r?.min ?? 1) - unique.length : (r?.max ?? 0) + 1;
      for (let i = 0; i < unique.length; i++) {
        await each(unique[i], () => tasks.moveCard(db, actor, unique[i], input.listId, start + i));
      }
      break;
    }
    case 'place':
      for (const it of input.items) await each(it.id, () => tasks.moveCard(db, actor, it.id, it.listId, it.position));
      break;
    case 'due':
      for (const it of input.items) await each(it.id, () => tasks.updateCard(db, actor, it.id, { dueDate: it.dueDate }));
      break;
    case 'color':
      for (const it of input.items) await each(it.id, () => tasks.updateCard(db, actor, it.id, { color: it.color }));
      break;
  }
  return result;
}
