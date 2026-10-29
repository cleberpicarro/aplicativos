import { one, many, type Db } from '../lib/db.js';
import { subWhere, type Actor } from './actors.js';
import { directReports } from './actors.js';
import * as subs from './substitution.js';
import { cardIdByCode, loadCard, parseCode, parseNum, selectCards } from './cards.js';
import { badRequest } from '../lib/errors.js';

/** Item 24: cores de fundo da área de trabalho. Os tons de cada uma, nos dois temas, ficam no front-end (.ws-*). */
export const WORKSPACE_COLORS = ['cinza-azulado', 'azul', 'verde-agua', 'verde', 'areia', 'lilas', 'rosa'] as const;

export async function setWorkspaceBg(db: Db, actor: Actor, color: string | null) {
  if (color !== null && !(WORKSPACE_COLORS as readonly string[]).includes(color)) throw badRequest('Cor inválida.');
  await db.query('UPDATE users SET workspace_bg = $2, updated_at = now() WHERE id = $1', [actor.id, color]);
}

/** Item 46: em "Meus dados", a pessoa liga ou desliga o resumo diário e os avisos de prazo por e-mail. */
export async function setEmailPrefs(db: Db, actor: Actor, prefs: { emailDigest?: boolean; emailDue?: boolean }) {
  await db.query(
    'UPDATE users SET email_digest = coalesce($2, email_digest), email_due = coalesce($3, email_due), updated_at = now() WHERE id = $1',
    [actor.id, prefs.emailDigest ?? null, prefs.emailDue ?? null],
  );
}

/** Item 66: lembrar a caixa "Esconder inativas" da tela Pessoas, na conta da pessoa. */
export async function setHideInactive(db: Db, actor: Actor, hide: boolean) {
  await db.query('UPDATE users SET hide_inactive = $2, updated_at = now() WHERE id = $1', [actor.id, hide]);
}

export async function me(db: Db, actor: Actor) {
  const reports = actor.level === null ? [] : await directReports(db, actor.id);
  const counts = await one(
    db,
    `SELECT
       (SELECT count(*)::int FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
         WHERE c.owner_id = $1 AND c.list_id IS NULL AND c.archived_at IS NULL AND (d.id IS NULL OR d.status = 'PENDING_ACCEPT')${subWhere(actor)}) AS inbox,
       (SELECT count(*)::int FROM delegations d JOIN cards c ON c.id = d.card_id
         WHERE d.delegator_id = $1 AND c.archived_at IS NULL AND d.status IN ('AWAITING_ACK','DECLINED')) AS need_action,
       (SELECT count(*)::int FROM notifications WHERE user_id = $1 AND read_at IS NULL) AS unread,
       (SELECT workspace_bg FROM users WHERE id = $1) AS workspace_bg,
       (SELECT email_digest FROM users WHERE id = $1) AS email_digest,
       (SELECT email_due FROM users WHERE id = $1) AS email_due,
       (SELECT hide_inactive FROM users WHERE id = $1) AS hide_inactive,
       (now() AT TIME ZONE 'America/Sao_Paulo')::date AS today`,
    [actor.id],
  );
  // Item 72: quem a pessoa substitui (opções do seletor do topo) e, fora da substituição, quem a substitui.
  const sub = actor.sub;
  const substitution = {
    covering: await subs.covering(db, sub ? sub.id : actor.id),
    acting: sub ? { id: actor.id, name: actor.name, shareCommon: sub.share, by: { id: sub.id, name: sub.name } } : null,
    mine: sub ? null : await subs.current(db, actor.id),
  };
  const { sub: _sub, ...user } = actor;
  return {
    substitution,
    user: { ...user, inHierarchy: actor.level !== null },
    directReports: reports.map((r) => ({ id: r.id, name: r.name, roleTitle: r.role_title })),
    counts: { inbox: counts.inbox, needAction: counts.need_action, unread: counts.unread },
    prefs: { workspaceBg: counts.workspace_bg as string | null, emailDigest: counts.email_digest as boolean, emailDue: counts.email_due as boolean, hideInactive: counts.hide_inactive as boolean },
    today: counts.today,
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
      `c.owner_id = $1 AND c.num = $2 AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))${subWhere(actor)}`,
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
    `${visible}${subWhere(actor)} AND (c.search @@ websearch_to_tsquery('portuguese', $2) OR c.title ILIKE '%' || $3 || '%' OR c.description ILIKE '%' || $3 || '%')`,
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
