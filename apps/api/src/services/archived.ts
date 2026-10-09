import { many, type Db } from '../lib/db.js';
import type { Actor } from './actors.js';
import { parseCode } from './cards.js';

/** Item 35: quantas tarefas a tela "Arquivadas" mostra por vez. */
export const ARCHIVED_PAGE = 50;

/**
 * Tarefas apagadas pelo "Desfazer" logo depois de criar várias (item 30): para quem usa, foram apagadas, não arquivadas.
 * Vale o último arquivamento: se a tarefa foi desarquivada depois (pela busca) e arquivada de novo, ela volta a contar.
 */
export const NOT_UNDONE = `(c.archived_at IS NULL OR coalesce((SELECT ue.after->>'undo' FROM card_events ue
  WHERE ue.card_id = c.id AND ue.type = 'archived' ORDER BY ue.id DESC LIMIT 1), '') <> 'true')`;

/** Texto da pesquisa: código (ST-000123, NT-…, 123) ou palavras do título e da descrição, como na busca do topo. */
export function textOrCode(q: string, params: unknown[]): string {
  const parts: string[] = [];
  const seq = parseCode(q);
  if (seq !== null) {
    params.push(seq);
    parts.push(`c.seq = $${params.length}`);
  }
  params.push(q);
  const full = params.length;
  params.push(q.replace(/[%_\\]/g, (m) => '\\' + m));
  const like = params.length;
  parts.push(`c.search @@ websearch_to_tsquery('portuguese', $${full})`, `c.title ILIKE '%' || $${like} || '%'`, `c.description ILIKE '%' || $${like} || '%'`);
  return `(${parts.join(' OR ')})`;
}

/**
 * Tarefas arquivadas por quem pede: as próprias que ela arquivou (podem ser desarquivadas) e as que ela delegou
 * e em que deu o ciente (só consulta: o ciente não se desfaz). Tarefa recebida por delegação fica de fora:
 * quem a arquivou foi o superior.
 */
export async function listArchived(db: Db, actor: Actor, q: string, offset: number) {
  const params: unknown[] = [actor.id];
  const query = q.trim();
  const search = query ? ` AND ${textOrCode(query, params)}` : '';
  params.push(ARCHIVED_PAGE + 1, offset);
  const rows = await many(
    db,
    `SELECT c.id, c.code, c.title, c.due_date, c.completed_at, c.archived_at, c.created_at,
            CASE WHEN d.id IS NULL THEN 'own' ELSE 'delegated' END AS kind,
            b.name AS board_name, l.name AS list_name, o.name AS delegated_to
       FROM cards c
       LEFT JOIN delegations d ON d.card_id = c.id
       LEFT JOIN lists l ON l.id = c.list_id AND d.id IS NULL
       LEFT JOIN boards b ON b.id = l.board_id
       JOIN users o ON o.id = c.owner_id
      WHERE c.archived_at IS NOT NULL
        AND ((c.owner_id = $1 AND d.id IS NULL AND ${NOT_UNDONE}) OR (d.delegator_id = $1 AND d.status = 'ACKED'))${search}
      ORDER BY c.archived_at DESC, c.seq DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    items: rows.slice(0, ARCHIVED_PAGE).map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      dueDate: r.due_date,
      completedAt: r.completed_at,
      archivedAt: r.archived_at,
      createdAt: r.created_at,
      kind: r.kind as 'own' | 'delegated',
      boardName: r.board_name ?? null,
      listName: r.list_name ?? null,
      delegatedTo: r.kind === 'delegated' ? (r.delegated_to as string) : null,
    })),
    hasMore: rows.length > ARCHIVED_PAGE,
  };
}
