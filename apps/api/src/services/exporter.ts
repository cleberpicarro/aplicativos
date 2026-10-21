import { many, type Db } from '../lib/db.js';
import { forbidden } from '../lib/errors.js';
import type { Actor } from './actors.js';

/**
 * Item 62: exporta todas as tarefas da pessoa num arquivo JSON.
 * Cada quadro vai no mesmo formato do JSON que o Trello exporta, para o "Importar arquivo JSON" ler de volta;
 * o que só existe no SyncTasks (número, privada, delegação…) vai no campo "synctasks" de cada cartão.
 */
export const EXPORT_FORMAT = 'synctasks-exportacao';

const SITUACAO: Record<string, string> = {
  PENDING_ACCEPT: 'Aguardando aceite',
  IN_PROGRESS: 'Em andamento',
  AWAITING_ACK: 'Concluída, aguardando ciente',
  DECLINED: 'Devolvida',
  ACKED: 'Ciente dado',
  CANCELED: 'Cancelada',
};

/** Prazo (dia) → meio-dia em Brasília, para cair no mesmo dia em qualquer fuso do Brasil. */
const due = (d: string | null) => (d ? `${d}T15:00:00.000Z` : null);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function exportAll(db: Db, actor: Actor) {
  if (actor.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros.');
  const boards = await many(
    db,
    'SELECT id, name, color, archived_at FROM boards WHERE owner_id = $1 ORDER BY archived_at IS NOT NULL, position, created_at',
    [actor.id],
  );
  const lists = await many(
    db,
    'SELECT id, board_id, name, position, archived_at FROM lists WHERE board_id = ANY($1) ORDER BY position, created_at',
    [boards.map((b) => b.id)],
  );
  // Tarefas da pessoa (nos quadros e na caixa de entrada), menos as delegações que ela recebeu e que foram devolvidas ou canceladas.
  const cards = await many(
    db,
    `SELECT c.id, c.list_id, c.position, c.num, c.title, c.description, to_char(c.due_date, 'YYYY-MM-DD') AS due_date,
            c.is_private, c.color, c.completed_at, c.archived_at, c.created_at,
            d.status AS d_status, d.reopened AS d_reopened, du.name AS delegator_name, tu.name AS transferred_from_name,
            ch.status AS ch_status, ch.owner_name AS ch_owner_name, ch.num AS ch_num
       FROM cards c
       LEFT JOIN delegations d ON d.card_id = c.id
       LEFT JOIN users du ON du.id = d.delegator_id
       LEFT JOIN users tu ON tu.id = c.transferred_from_id
       LEFT JOIN LATERAL (
         SELECT cd.status, u.name AS owner_name, cc.num FROM delegations cd
           JOIN cards cc ON cc.id = cd.card_id JOIN users u ON u.id = cc.owner_id
          WHERE cd.parent_card_id = c.id AND cd.status NOT IN ('DECLINED','CANCELED')
          ORDER BY cd.created_at DESC LIMIT 1
       ) ch ON true
      WHERE c.owner_id = $1 AND (d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))
      ORDER BY c.position, c.seq`,
    [actor.id],
  );
  const ids = cards.map((c) => c.id);
  const checklist = await many(db, 'SELECT card_id, text, done, position FROM checklist_items WHERE card_id = ANY($1) ORDER BY position', [ids]);
  const comments = await many(
    db,
    `SELECT cm.id, cm.card_id, cm.body, cm.created_at, u.name AS author_name
       FROM comments cm JOIN users u ON u.id = cm.author_id WHERE cm.card_id = ANY($1) ORDER BY cm.created_at`,
    [ids],
  );

  const toCard = (c: any, idList: string, pos: number) => ({
    id: c.id,
    idList,
    name: c.title,
    desc: c.description,
    due: due(c.due_date),
    dueComplete: !!c.completed_at,
    closed: !!c.archived_at,
    pos,
    idMembers: [] as string[],
    synctasks: {
      numero: c.num,
      privada: c.is_private,
      cor: c.color,
      criadaEm: iso(c.created_at),
      concluidaEm: iso(c.completed_at),
      arquivadaEm: iso(c.archived_at),
      ...(c.d_status ? { delegadaPor: c.delegator_name, situacaoDaDelegacao: c.d_reopened && c.d_status === 'IN_PROGRESS' ? 'Reaberta' : SITUACAO[c.d_status] } : {}),
      ...(c.ch_status ? { delegadaPara: c.ch_owner_name, numeroNoQuadroDeQuemRecebeu: c.ch_num, situacaoDaDelegacao: SITUACAO[c.ch_status] } : {}),
      ...(c.transferred_from_name ? { transferidaPor: c.transferred_from_name } : {}),
    },
  });

  // Checklist e comentários ficam fora dos cartões, como no arquivo do Trello.
  const extras = (cardIds: Set<string>) => ({
    checklists: [...cardIds].flatMap((id) => {
      const items = checklist.filter((i) => i.card_id === id);
      return items.length
        ? [{ id: `cl-${id}`, idCard: id, name: 'Checklist', pos: 1, checkItems: items.map((i, k) => ({ name: i.text, state: i.done ? 'complete' : 'incomplete', pos: k + 1 })) }]
        : [];
    }),
    actions: comments
      .filter((m) => cardIds.has(m.card_id))
      .map((m) => ({ id: m.id, type: 'commentCard', date: iso(m.created_at), data: { text: m.body, card: { id: m.card_id } }, memberCreator: { fullName: m.author_name } })),
    members: [] as unknown[],
  });

  const quadros: unknown[] = boards.map((b) => {
    const bl = lists.filter((l) => l.board_id === b.id);
    const listIds = new Set(bl.map((l) => l.id));
    const bc = cards.filter((c) => listIds.has(c.list_id));
    return {
      id: b.id,
      name: b.name,
      closed: !!b.archived_at,
      synctasks: { cor: b.color },
      lists: bl.map((l, i) => ({ id: l.id, name: l.name, closed: !!l.archived_at, pos: i + 1 })),
      cards: bc.map((c, i) => toCard(c, c.list_id, i + 1)),
      ...extras(new Set(bc.map((c) => c.id))),
    };
  });

  // A caixa de entrada vai como um quadro à parte, com uma fase só.
  const inbox = cards.filter((c) => c.list_id === null);
  if (inbox.length) {
    quadros.push({
      id: 'caixa-de-entrada',
      name: 'Caixa de entrada',
      closed: false,
      synctasks: { caixaDeEntrada: true },
      lists: [{ id: 'caixa-de-entrada', name: 'Caixa de entrada', closed: false, pos: 1 }],
      cards: inbox.map((c, i) => toCard(c, 'caixa-de-entrada', i + 1)),
      ...extras(new Set(inbox.map((c) => c.id))),
    });
  }

  return { formato: EXPORT_FORMAT, versao: 1, exportadoEm: new Date().toISOString(), pessoa: actor.name, quadros };
}
