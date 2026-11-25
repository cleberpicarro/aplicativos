import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTrello } from './trello';

const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/trello-board.json', import.meta.url), 'utf8'));

describe('leitor do JSON do Trello', () => {
  const { payload, stats } = parseTrello(fixture);

  it('mantém só as listas ativas, na ordem do Trello', () => {
    expect(payload.boardName).toBe('Marketing 2026');
    expect(payload.lists.map((l) => l.name)).toEqual(['A fazer', 'Em andamento', 'Concluído']);
  });

  it('ignora cartões arquivados e cartões de listas arquivadas', () => {
    expect(payload.lists[0].cards.map((c) => c.title)).toEqual(['Revisar textos do site', 'Campanha de lançamento']);
    expect(stats).toMatchObject({ lists: 3, cards: 4, archivedLists: 1, archivedCards: 2 });
  });

  it('traz prazo, conclusão, membros, checklists e comentários', () => {
    const c = payload.lists[0].cards[1];
    expect(c.dueDate).toMatch(/^2026-11-2\d$/);
    expect(c.completed).toBe(false);
    expect(c.members).toEqual(['Ana Souza', 'Bruno Lima']);
    // dois checklists: itens juntados, com o nome do checklist na frente, na ordem do Trello
    expect(c.checklist).toEqual([
      { text: 'Preparação: Definir público', done: true },
      { text: 'Preparação: Aprovar orçamento', done: false },
      { text: 'Divulgação: Post no Instagram', done: false },
    ]);
    // só comentários, do mais antigo para o mais novo
    expect(c.comments.map((x) => x.author)).toEqual(['Ana Souza', 'Bruno Lima']);
    const done = payload.lists[2].cards[0];
    expect(done.completed).toBe(true);
    expect(stats).toMatchObject({ checklistItems: 3, comments: 2, completed: 1, labels: 1, attachments: 2 });
  });

  it('membro sem nome no arquivo é ignorado', () => {
    expect(payload.lists[1].cards[0].members).toEqual([]);
  });

  it('recusa arquivos que não são do Trello', () => {
    expect(() => parseTrello({ foo: 1 })).toThrow(/não parece ser um quadro exportado do Trello/);
    expect(() => parseTrello({ name: 'x', lists: [{ id: 'a', closed: true }], cards: [] })).toThrow(/não tem listas ativas/);
  });
});
