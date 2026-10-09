/**
 * Item 31: exporta um quadro do SyncTasks para o Trello.
 * Tudo acontece no navegador: o código de acesso que o Trello devolve nunca passa pelo servidor do SyncTasks.
 */
import type { Board, Card, CardDetail } from './api';
import { STATUS, dateTime, delegationKey, statusOf } from './format';

export interface ExportCard {
  name: string;
  desc: string;
  due: string | null;
  dueComplete: boolean;
  checklist: { name: string; checked: boolean }[];
  comments: string[];
}

export interface TrelloExport {
  boardName: string;
  lists: { name: string; cards: ExportCard[] }[];
}

const MAX_TEXT = 16384; // limite do Trello para descrição e comentário
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Tarefas do quadro que vão para o Trello, na ordem das fases. Privadas só se a pessoa marcar. */
export function exportableCards(board: Board, includePrivate: boolean): Card[] {
  return board.cards.filter((c) => !c.archivedAt && (includePrivate || !c.isPrivate));
}

function describe(c: Card): string {
  const lines = [`Número no SyncTasks: #${c.num}`, `Situação: ${STATUS[statusOf(c)].label}`];
  if (c.delegation) lines.push(`Delegada por ${c.delegation.delegatorName}${c.delegation.parentNum != null ? ` (tarefa #${c.delegation.parentNum})` : ''}`);
  if (c.child) lines.push(`Delegada para ${c.child.ownerName} (#${c.child.num}): ${STATUS[delegationKey(c.child.status, c.child.reopened)].label}`);
  if (c.transferredFrom) lines.push(`Transferida por ${c.transferredFrom.name}`);
  if (c.isPrivate) lines.push('Privada no SyncTasks');
  const head = lines.join('\n');
  return cut(c.description.trim() ? `${head}\n\n---\n\n${c.description}` : head, MAX_TEXT);
}

/** Monta o que será criado no Trello a partir do quadro e dos detalhes de cada tarefa (checklist e comentários). */
export function buildTrelloExport(board: Board, details: Map<string, CardDetail>, includePrivate: boolean): TrelloExport {
  const cards = exportableCards(board, includePrivate);
  return {
    boardName: board.name,
    lists: [...board.lists]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        name: l.name,
        cards: cards
          .filter((c) => c.listId === l.id)
          .sort((a, b) => a.position - b.position)
          .map((c): ExportCard => {
            const d = details.get(c.id);
            return {
              name: c.title,
              desc: describe(c),
              // Meio-dia em Brasília: o Trello mostra o mesmo dia em qualquer fuso do Brasil.
              due: c.dueDate ? `${c.dueDate.slice(0, 10)}T12:00:00-03:00` : null,
              dueComplete: !!c.completedAt,
              checklist: (d?.checklistItems ?? []).map((i) => ({ name: i.text, checked: i.done })),
              comments: (d?.comments ?? []).map((m) => cut(`${m.authorName}, em ${dateTime(m.createdAt)}:\n\n${m.body}`, MAX_TEXT)),
            };
          }),
      })),
  };
}

/** Quantas chamadas ao Trello a exportação vai fazer (para a barra de progresso). */
export function countSteps(e: TrelloExport): number {
  let n = 1 + e.lists.length;
  for (const l of e.lists) for (const c of l.cards) n += 1 + (c.checklist.length ? 1 + c.checklist.length : 0) + c.comments.length;
  return n;
}

export function authorizeUrl(key: string, returnTo: string | null): string {
  const p = new URLSearchParams({ expiration: '1day', name: 'SyncTasks', scope: 'read,write', response_type: 'token', key });
  // Sem retorno, o Trello mostra o código na tela para a pessoa copiar e colar.
  if (returnTo) { p.set('callback_method', 'postMessage'); p.set('return_url', returnTo); }
  return `https://trello.com/1/authorize?${p}`;
}

export const looksLikeToken = (t: string) => /^[A-Za-z0-9]{32,}$/.test(t.trim());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cria no Trello um quadro novo com as listas e os cartões. Devolve o endereço do quadro.
 * Respeita o limite do Trello (100 chamadas a cada 10 segundos por pessoa) e repete quando ele pede para esperar.
 */
export async function sendToTrello(
  e: TrelloExport,
  auth: { key: string; token: string },
  onStep: (done: number, total: number) => void,
  opts: { fetch?: typeof fetch; gapMs?: number } = {},
): Promise<string> {
  const doFetch = opts.fetch ?? fetch;
  const gap = opts.gapMs ?? 110;
  const total = countSteps(e);
  let done = 0;
  let last = 0;

  const call = async (path: string, params: Record<string, string>): Promise<any> => {
    for (let attempt = 0; ; attempt++) {
      const since = Date.now() - last;
      if (since < gap) await wait(gap - since);
      last = Date.now();
      const url = `https://api.trello.com/1${path}?${new URLSearchParams({ key: auth.key, token: auth.token })}`;
      let res: Response;
      try {
        res = await doFetch(url, { method: 'POST', body: new URLSearchParams(params) });
      } catch {
        throw new Error('Não foi possível falar com o Trello. Confira a internet e tente de novo.');
      }
      if (res.status === 429 && attempt < 6) { await wait(2000 * (attempt + 1)); continue; }
      if (res.status === 401) throw new Error('O Trello recusou o acesso (a permissão expirou ou foi negada). Conecte ao Trello de novo.');
      if (!res.ok) throw new Error(`O Trello respondeu com erro (${res.status}). Parte do quadro pode ter sido criada; confira no Trello.`);
      onStep(++done, total);
      return res.json();
    }
  };

  const board = await call('/boards', { name: e.boardName, defaultLists: 'false' });
  for (const l of e.lists) {
    const list = await call('/lists', { name: l.name, idBoard: board.id, pos: 'bottom' });
    for (const c of l.cards) {
      const params: Record<string, string> = { idList: list.id, name: c.name, desc: c.desc, pos: 'bottom', dueComplete: String(c.dueComplete) };
      if (c.due) params.due = c.due;
      const card = await call('/cards', params);
      if (c.checklist.length) {
        const cl = await call('/checklists', { idCard: card.id, name: 'Checklist' });
        for (const it of c.checklist) await call(`/checklists/${cl.id}/checkItems`, { name: it.name, checked: String(it.checked), pos: 'bottom' });
      }
      for (const text of c.comments) await call(`/cards/${card.id}/actions/comments`, { text });
    }
  }
  return board.url ?? board.shortUrl ?? 'https://trello.com';
}
