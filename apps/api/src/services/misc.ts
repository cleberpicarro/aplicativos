import { config } from '../config.js';
import { one, many, type Db } from '../lib/db.js';
import type { Actor } from './actors.js';
import { directReports } from './actors.js';
import { cardIdByCode, loadCard, parseCode, parseNum, selectCards } from './cards.js';
import { badRequest } from '../lib/errors.js';

/** Item 24: cores de fundo da área de trabalho. Os tons de cada uma, nos dois temas, ficam no front-end (.ws-*). */
export const WORKSPACE_COLORS = ['cinza-azulado', 'azul', 'verde-agua', 'verde', 'areia', 'lilas', 'rosa'] as const;

export async function setWorkspaceBg(db: Db, actor: Actor, color: string | null) {
  if (color !== null && !(WORKSPACE_COLORS as readonly string[]).includes(color)) throw badRequest('Cor inválida.');
  await db.query('UPDATE users SET workspace_bg = $2, updated_at = now() WHERE id = $1', [actor.id, color]);
}

export async function me(db: Db, actor: Actor) {
  const reports = actor.level === null ? [] : await directReports(db, actor.id);
  const counts = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
         WHERE c.owner_id = $1 AND c.list_id IS NULL AND c.archived_at IS NULL AND (d.id IS NULL OR d.status = 'PENDING_ACCEPT')) AS inbox,
       (SELECT count(*)::int FROM delegations d JOIN cards c ON c.id = d.card_id
         WHERE d.delegator_id = $1 AND c.archived_at IS NULL AND d.status IN ('AWAITING_ACK','DECLINED')) AS need_action,
       (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS unread,
       (SELECT workspace_bg FROM users WHERE id = $1) AS workspace_bg,
       (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today`,
    [actor.id],
  );
  return {
    user: { ...actor, inHierarchy: actor.level !== null },
    directReports: reports.map((r) => ({ id: r.id, name: r.name, roleTitle: r.role_title })),
    counts: { inbox: counts.inbox, needAction: counts.need_action, unread: counts.unread },
    prefs: { workspaceBg: counts.workspace_bg as string | null },
    today: counts.today,
    trelloKey: config.trelloKey,
  };
}

/**
 * Busca por número (item 37: 12 ou #12, nas tarefas da própria pessoa; abre direto a do quadro aberto ou a única),
 * pelo código antigo ST-/NT- (abre direto) ou por texto no título e na descrição, só no que a pessoa pode ver.
 */
export async function search(db: Db, actor: Actor, q: string, boardId?: string) {
  const query = q.trim();
  if (!query) return { byCode: null, results: [] };
  const num = parseNum(query);
  if (num !== null) {
    const mine = await selectCards(
      db,
      `c.owner_id = $1 AND c.num = $2 AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))`,
      [actor.id, num],
      'c.archived_at NULLS FIRST, bo.position NULLS FIRST, c.seq',
    );
    const here = boardId ? mine.find((c) => c.boardId === boardId && !c.archivedAt) : undefined;
    const open = mine.filter((c) => !c.archivedAt);
    const only = here ?? (open.length === 1 ? open[0] : mine.length === 1 ? mine[0] : undefined);
    if (only) return { byCode: { ...only, role: 'owner' }, results: [] };
    if (mine.length) return { byCode: null, results: mine };
  }
  if (parseCode(query) !== null) {
    const id = await cardIdByCode(db, query);
    if (id) {
      try {
        const { dto, role } = await loadCard(db, actor, id);
        return { byCode: { ...dto, role }, results: [] };
      } catch {
        /* não visível: segue para a busca por texto */
      }
    }
  }
  const visible = `((c.owner_id = $1 AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))) OR d.delegator_id = $1)`;
  const results = await selectCards(
    db,
    `${visible} AND (c.search @@ websearch_to_tsquery('portuguese', $2) OR c.title ILIKE '%' || $3 || '%' OR c.description ILIKE '%' || $3 || '%')`,
    [actor.id, query, query.replace(/[%_\\]/g, (m) => '\\' + m)],
    'c.archived_at NULLS FIRST, c.updated_at DESC LIMIT 30',
  );
  return { byCode: null, results };
}

export async function listNotifications(db: Db, actor: Actor) {
  return many(
    db,
    `SELECT n.id, n.type, n.text, n.read_at, n.created_at, c.id AS card_id, c.code AS card_code, c.num AS card_num, c.title AS card_title
       FROM notifications n LEFT JOIN cards c ON c.id = n.card_id
      WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 100`,
    [actor.id],
  );
}

export async function markNotificationsRead(db: Db, actor: Actor) {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [actor.id]);
}
