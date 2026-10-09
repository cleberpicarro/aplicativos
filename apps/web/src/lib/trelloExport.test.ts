import { describe, it, expect } from 'vitest';
import type { Board, Card, CardDetail } from './api';
import { authorizeUrl, buildTrelloExport, countSteps, looksLikeToken, sendToTrello } from './trelloExport';

const card = (p: Partial<Card>): Card => ({
  id: 'x', code: 'ST-000001', num: 1, title: 'Tarefa', description: '', dueDate: null, isPrivate: false, completedAt: null, archivedAt: null,
  ownerId: 'u', ownerName: 'Ana', boardId: 'b', boardName: 'Projetos', color: null, listId: 'l1', position: 1, inInbox: false, transferredFrom: null,
  delegation: null, child: null, checklist: { done: 0, total: 0 }, source: null, createdAt: '2026-10-01T12:00:00Z', ...p,
});

const board: Board = {
  id: 'b', name: 'Projetos', color: null,
  lists: [{ id: 'l2', name: 'Feito', position: 2 }, { id: 'l1', name: 'A fazer', position: 1 }],
  cards: [
    card({ id: 'c2', code: 'ST-000002', num: 2, title: 'Segunda', position: 2, dueDate: '2026-11-20', description: 'Detalhes' }),
    card({ id: 'c1', code: 'ST-000001', num: 1, title: 'Primeira', position: 1,
      child: { delegationId: 'd', cardId: 'f', code: 'ST-000009', num: 9, ownerName: 'Bruno', status: 'AWAITING_ACK', reopened: false } }),
    card({ id: 'c3', code: 'ST-000003', num: 3, title: 'Pronta', listId: 'l2', completedAt: '2026-10-02T10:00:00Z' }),
    card({ id: 'c4', code: 'ST-000004', num: 4, title: 'Segredo', isPrivate: true }),
    card({ id: 'c5', code: 'ST-000005', num: 5, title: 'Velha', archivedAt: '2026-10-03T10:00:00Z' }),
  ],
};

const details = new Map<string, CardDetail>([
  ['c2', { checklistItems: [{ id: 'i1', text: 'Passo 1', done: true }, { id: 'i2', text: 'Passo 2', done: false }],
    comments: [{ id: 'm', body: 'Olá', createdAt: '2026-10-01T15:00:00Z', authorId: 'u', authorName: 'Ana' }] } as CardDetail],
]);

describe('exportar para o Trello', () => {
  const plan = buildTrelloExport(board, details, false);

  it('mantém as fases e as tarefas na ordem; arquivadas e privadas ficam de fora', () => {
    expect(plan.boardName).toBe('Projetos');
    expect(plan.lists.map((l) => l.name)).toEqual(['A fazer', 'Feito']);
    expect(plan.lists[0].cards.map((c) => c.name)).toEqual(['Primeira', 'Segunda']);
    expect(plan.lists[1].cards.map((c) => c.name)).toEqual(['Pronta']);
    expect(buildTrelloExport(board, details, true).lists[0].cards.map((c) => c.name)).toContain('Segredo');
  });

  it('leva número, situação, delegação, prazo, conclusão, checklist e comentários', () => {
    const [primeira, segunda] = plan.lists[0].cards;
    expect(primeira.desc).toContain('Número no SyncTasks: #1');
    expect(primeira.desc).toContain('Delegada para Bruno (#9): Concluída, aguardando ciente');
    expect(segunda.desc).toMatch(/#2[\s\S]*---\n\nDetalhes$/);
    expect(segunda.due).toBe('2026-11-20T12:00:00-03:00');
    expect(segunda.checklist).toEqual([{ name: 'Passo 1', checked: true }, { name: 'Passo 2', checked: false }]);
    expect(segunda.comments[0]).toMatch(/^Ana, em .+:\n\nOlá$/);
    expect(plan.lists[1].cards[0].dueComplete).toBe(true);
    expect(primeira.due).toBeNull();
  });

  it('envia ao Trello na ordem certa e devolve o endereço do quadro', async () => {
    const calls: { path: string; body: URLSearchParams }[] = [];
    let n = 0;
    let busy = true;
    const fake = (async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace('/1', '');
      // primeira chamada de cartão: o Trello pede para esperar
      if (path === '/cards' && busy) { busy = false; return new Response('', { status: 429 }); }
      calls.push({ path, body: init.body as URLSearchParams });
      return new Response(JSON.stringify({ id: `id${++n}`, url: 'https://trello.com/b/abc/projetos' }));
    }) as typeof fetch;
    const steps: number[] = [];
    const url = await sendToTrello(plan, { key: 'k', token: 't' }, (d) => steps.push(d), { fetch: fake, gapMs: 0 });
    expect(url).toBe('https://trello.com/b/abc/projetos');
    expect(calls.map((c) => c.path)).toEqual([
      '/boards', '/lists', '/cards', '/cards', '/checklists', '/checklists/id5/checkItems', '/checklists/id5/checkItems', '/cards/id4/actions/comments',
      '/lists', '/cards',
    ]);
    expect(calls[0].body.get('defaultLists')).toBe('false');
    expect(calls[2].body.get('due')).toBeNull();
    expect(calls[3].body.get('due')).toBe('2026-11-20T12:00:00-03:00');
    expect(calls[9].body.get('dueComplete')).toBe('true');
    expect(steps.at(-1)).toBe(countSteps(plan));
  }, 15000);

  it('avisa quando o Trello recusa o acesso', async () => {
    const fake = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(sendToTrello(plan, { key: 'k', token: 't' }, () => {}, { fetch: fake, gapMs: 0 })).rejects.toThrow(/Conecte ao Trello de novo/);
  });

  it('monta o endereço de permissão e reconhece o código', () => {
    expect(authorizeUrl('k', 'https://app')).toContain('callback_method=postMessage');
    expect(authorizeUrl('k', null)).not.toContain('return_url');
    expect(looksLikeToken('ATTA' + 'a1'.repeat(30))).toBe(true);
    expect(looksLikeToken('abc')).toBe(false);
  });
});
