import { z } from 'zod';
import { one, type Db } from '../lib/db.js';
import { badRequest, forbidden } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { nextPosition } from './cards.js';
import { logEvent } from './events.js';

/** Formato enviado pelo navegador depois de ler o JSON exportado do Trello. */
export const trelloImportSchema = z.object({
  boardName: z.string().trim().min(1).max(80),
  lists: z
    .array(
      z.object({
        name: z.string().max(60),
        cards: z
          .array(
            z.object({
              title: z.string().trim().min(1).max(200),
              description: z.string().max(20000),
              dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
              completed: z.boolean(),
              members: z.array(z.string().max(120)).max(50),
              checklist: z.array(z.object({ text: z.string().trim().min(1).max(300), done: z.boolean() })).max(300),
              comments: z
                .array(z.object({ author: z.string().max(120), date: z.string().max(40), text: z.string().max(5000) }))
                .max(500),
            }),
          )
          .max(5000),
      }),
    )
    .min(1)
    .max(100),
});

export type TrelloImport = z.infer<typeof trelloImportSchema>;

const MAX_CARDS = 5000;

/** Data e hora no fuso de São Paulo, no formato 30/09/2026 06:15 (independe da configuração do servidor). */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

/** Cria um quadro novo de quem importa, com as listas como fases e os cartões como tarefas dessa pessoa. */
export async function importTrello(db: Db, actor: Actor, data: TrelloImport) {
  if (actor.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros.');
  const total = data.lists.reduce((n, l) => n + l.cards.length, 0);
  if (total > MAX_CARDS) throw badRequest(`O arquivo tem ${total} cartões ativos; o limite por importação é ${MAX_CARDS}.`);

  const position = await nextPosition(db, 'SELECT max(position) AS max FROM boards WHERE owner_id = $1', [actor.id]);
  const board = await one(db, 'INSERT INTO boards (owner_id, name, position) VALUES ($1, $2, $3) RETURNING id', [actor.id, data.boardName.trim(), position]);

  let cards = 0, items = 0, comments = 0;
  for (let i = 0; i < data.lists.length; i++) {
    const l = data.lists[i];
    const listName = l.name.trim() || 'Sem nome';
    const list = await one(db, 'INSERT INTO lists (board_id, name, position) VALUES ($1, $2, $3) RETURNING id', [board.id, listName, i + 1]);
    for (let j = 0; j < l.cards.length; j++) {
      const c = l.cards[j];
      const members = c.members.filter((m) => m.trim());
      const description = members.length
        ? `${c.description}${c.description ? '\n\n' : ''}Membros no Trello: ${members.join(', ')}`
        : c.description;
      const card = await one(
        db,
        `INSERT INTO cards (owner_id, list_id, position, title, description, due_date, completed_at, created_by, source)
         VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7 THEN now() END, $1, 'trello') RETURNING id`,
        [actor.id, list.id, j + 1, c.title, description, c.dueDate, c.completed],
      );
      await logEvent(db, card.id, actor.id, 'imported', undefined, { source: 'Trello', board: data.boardName, list: listName });
      for (let k = 0; k < c.checklist.length; k++) {
        await db.query('INSERT INTO checklist_items (card_id, text, done, position) VALUES ($1, $2, $3, $4)', [card.id, c.checklist[k].text, c.checklist[k].done, k + 1]);
      }
      for (const cm of c.comments) {
        if (!cm.text.trim()) continue;
        // clock_timestamp(): na mesma transação, now() é igual para todos e a ordem se perderia.
        await db.query('INSERT INTO comments (card_id, author_id, body, created_at) VALUES ($1, $2, $3, clock_timestamp())', [
          card.id,
          actor.id,
          `Comentário de ${cm.author || 'alguém'} no Trello em ${fmtDateTime(cm.date)}:\n${cm.text.trim()}`,
        ]);
        comments++;
      }
      items += c.checklist.length;
      cards++;
    }
  }
  return { boardId: board.id as string, lists: data.lists.length, cards, checklistItems: items, comments };
}
