import { one, many, type Db } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { canSeeLog, type Actor } from './actors.js';

export type ViewerRole = 'owner' | 'delegator' | 'auditor';

/** Linha completa do cartão: delegação recebida, delegação para baixo (filho) e contagem do checklist. */
export const CARD_SELECT = `
  SELECT c.*, l.board_id, o.name AS owner_name,
    d.id AS d_id, d.status AS d_status, d.reopened AS d_reopened, d.delegator_id AS d_delegator_id,
    du.name AS d_delegator_name, d.suggested_due AS d_suggested_due, d.decline_reason AS d_decline_reason,
    tf.name AS transferred_from_name,
    pc.code AS parent_code,
    ch.id AS child_delegation_id, ch.card_id AS child_card_id, ch.status AS child_status, ch.reopened AS child_reopened,
    chc.code AS child_code, cho.name AS child_owner_name,
    (SELECT count(*) FROM checklist_items i WHERE i.card_id = c.id)::int AS cl_total,
    (SELECT count(*) FROM checklist_items i WHERE i.card_id = c.id AND i.done)::int AS cl_done
  FROM cards c
  JOIN users o ON o.id = c.owner_id
  LEFT JOIN lists l ON l.id = c.list_id
  LEFT JOIN delegations d ON d.card_id = c.id
  LEFT JOIN users du ON du.id = d.delegator_id
  LEFT JOIN users tf ON tf.id = c.transferred_from_id
  LEFT JOIN cards pc ON pc.id = d.parent_card_id
  LEFT JOIN LATERAL (
    SELECT * FROM delegations x WHERE x.parent_card_id = c.id AND x.status <> 'CANCELED'
    ORDER BY x.created_at DESC LIMIT 1
  ) ch ON true
  LEFT JOIN cards chc ON chc.id = ch.card_id
  LEFT JOIN users cho ON cho.id = chc.owner_id
`;

export interface CardDto {
  id: string;
  code: string;
  title: string;
  description: string;
  dueDate: string | null;
  isPrivate: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  ownerId: string;
  ownerName: string;
  boardId: string | null;
  listId: string | null;
  position: number;
  inInbox: boolean;
  transferredFrom: { id: string; name: string } | null;
  delegation: null | {
    id: string;
    status: string;
    reopened: boolean;
    delegatorId: string;
    delegatorName: string;
    suggestedDue: string | null;
    declineReason: string | null;
    parentCode: string | null;
  };
  child: null | { delegationId: string; cardId: string; code: string; ownerName: string; status: string; reopened: boolean };
  checklist: { done: number; total: number };
  createdAt: string;
}

export function toCardDto(r: any): CardDto {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    isPrivate: r.is_private,
    completedAt: r.completed_at,
    archivedAt: r.archived_at,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    boardId: r.board_id ?? null,
    listId: r.list_id,
    position: r.position,
    inInbox: r.list_id === null && !r.archived_at && (!r.d_id || r.d_status === 'PENDING_ACCEPT'),
    transferredFrom: r.transferred_from_id ? { id: r.transferred_from_id, name: r.transferred_from_name } : null,
    delegation: r.d_id
      ? {
          id: r.d_id,
          status: r.d_status,
          reopened: r.d_reopened,
          delegatorId: r.d_delegator_id,
          delegatorName: r.d_delegator_name,
          suggestedDue: r.d_suggested_due,
          declineReason: r.d_decline_reason,
          parentCode: r.parent_code,
        }
      : null,
    child: r.child_delegation_id
      ? {
          delegationId: r.child_delegation_id,
          cardId: r.child_card_id,
          code: r.child_code,
          ownerName: r.child_owner_name,
          status: r.child_status,
          reopened: r.child_reopened,
        }
      : null,
    checklist: { done: r.cl_done, total: r.cl_total },
    createdAt: r.created_at,
  };
}

export async function selectCards(db: Db, where: string, params: unknown[], orderBy = 'c.position'): Promise<CardDto[]> {
  const rows = await many(db, `${CARD_SELECT} WHERE ${where} ORDER BY ${orderBy}`, params);
  return rows.map(toCardDto);
}

/** Uma delegação recebida que foi devolvida ou cancelada deixa de ser visível para quem a recebeu. */
function ownerLostAccess(r: any): boolean {
  return r.d_status === 'DECLINED' || r.d_status === 'CANCELED';
}

export async function roleFor(db: Db, actor: Actor, r: any): Promise<ViewerRole | null> {
  if (r.owner_id === actor.id && !ownerLostAccess(r)) return 'owner';
  if (r.d_delegator_id === actor.id) return 'delegator';
  if (await canSeeLog(db, actor, { owner_id: r.owner_id, is_private: r.is_private, delegator_id: r.d_delegator_id })) return 'auditor';
  return null;
}

/** Carrega o cartão e o papel de quem está vendo. 404 quando não existe ou não é visível (não revela existência). */
export async function loadCard(db: Db, actor: Actor, cardId: string, opts: { lock?: boolean } = {}) {
  if (opts.lock) await db.query('SELECT 1 FROM cards WHERE id = $1 FOR UPDATE', [cardId]);
  const r = await one(db, `${CARD_SELECT} WHERE c.id = $1`, [cardId]);
  if (!r) throw notFound('Tarefa não encontrada.');
  const role = await roleFor(db, actor, r);
  if (!role) throw notFound('Tarefa não encontrada.');
  return { row: r, role, dto: toCardDto(r) };
}

export function parseCode(input: string): number | null {
  const m = /^\s*(?:nt\s*-?\s*)?0*(\d{1,15})\s*$/i.exec(input);
  return m ? Number(m[1]) : null;
}

export async function cardIdByCode(db: Db, code: string): Promise<string | null> {
  const seq = parseCode(code);
  if (seq === null) return null;
  const r = await one(db, 'SELECT id FROM cards WHERE seq = $1', [seq]);
  return r?.id ?? null;
}

export async function cardDetail(db: Db, actor: Actor, cardId: string) {
  const { row, role, dto } = await loadCard(db, actor, cardId);
  const checklist = await many(db, `SELECT id, text, done, position FROM checklist_items WHERE card_id = $1 ORDER BY position`, [cardId]);
  const comments = await many(
    db,
    `SELECT cm.id, cm.body, cm.created_at, u.id AS author_id, u.name AS author_name
       FROM comments cm JOIN users u ON u.id = cm.author_id WHERE cm.card_id = $1 ORDER BY cm.created_at`,
    [cardId],
  );
  const logVisible = await canSeeLog(db, actor, { owner_id: row.owner_id, is_private: row.is_private, delegator_id: row.d_delegator_id });
  let board = null;
  if (role === 'owner' && row.board_id) {
    const b = await one(db, 'SELECT id, name FROM boards WHERE id = $1', [row.board_id]);
    const lists = await many(db, 'SELECT id, name FROM lists WHERE board_id = $1 AND archived_at IS NULL ORDER BY position', [row.board_id]);
    board = { ...b, lists };
  }
  return {
    card: dto,
    role,
    canSeeLog: logVisible,
    board,
    checklistItems: checklist,
    comments: comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.created_at, authorId: c.author_id, authorName: c.author_name })),
  };
}

export async function nextPosition(db: Db, sql: string, params: unknown[]): Promise<number> {
  const r = await one<{ max: number | null }>(db, sql, params);
  return (r?.max ?? 0) + 1;
}

export function cardRef(r: { id: string; code: string; title: string }) {
  return { id: r.id, code: r.code, title: r.title };
}
