/** Item 103 (revisão geral, F1): tarefas que se repetem. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, day, type Ctx } from './helpers.js';
import { nextDue } from '../src/services/tasks.js';

describe('próximo prazo', () => {
  // 2026-11-13 é sexta-feira
  it('todo dia útil pula o fim de semana', () => {
    expect(nextDue('uteis', null, '2026-11-13', '2026-11-13')).toBe('2026-11-16');
    expect(nextDue('uteis', null, '2026-11-11', '2026-11-11')).toBe('2026-11-12');
  });
  it('semanal: próximo dia da semana escolhido, depois do prazo e de hoje', () => {
    expect(nextDue('semanal', 5, '2026-11-13', '2026-11-12')).toBe('2026-11-20'); // concluída antes do prazo
    expect(nextDue('semanal', 5, '2026-11-13', '2026-11-16')).toBe('2026-11-20'); // concluída atrasada
    expect(nextDue('semanal', 1, null, '2026-11-13')).toBe('2026-11-16');
  });
  it('mensal: mesmo dia no próximo mês; em mês curto, o último dia', () => {
    expect(nextDue('mensal', 10, '2026-11-10', '2026-11-10')).toBe('2026-12-10');
    expect(nextDue('mensal', 31, '2027-01-31', '2027-01-31')).toBe('2027-02-28');
    expect(nextDue('mensal', 20, null, '2026-11-05')).toBe('2026-11-20');
  });
  it('a cada N dias, a partir do prazo, sem cair no passado', () => {
    expect(nextDue('dias', 3, '2026-11-10', '2026-11-10')).toBe('2026-11-13');
    expect(nextDue('dias', 3, '2026-11-01', '2026-11-10')).toBe('2026-11-13');
  });
});

let ctx: Ctx;
let call: ReturnType<typeof api>;
beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});
const card = async (who: string, id: string) => (await call(who, 'GET', `/api/cards/${id}`)).body;

describe('repetir a tarefa', () => {
  it('ao concluir, nasce a próxima na mesma fase, com o próximo prazo, checklist desmarcado e log ligando as duas', async () => {
    const t = await newTask(ctx, 'func', 'Relatório semanal', day(0));
    await call('func', 'POST', `/api/cards/${t.id}/checklist`, { text: 'Juntar números' });
    const items = (await card('func', t.id)).checklistItems;
    await call('func', 'PATCH', `/api/cards/${t.id}/checklist/${items[0].id}`, { done: true });
    expect((await call('func', 'PATCH', `/api/cards/${t.id}`, { repeat: { kind: 'dias', n: 7 } })).status).toBe(200);
    expect((await card('func', t.id)).card.repeat).toEqual({ kind: 'dias', n: 7 });

    const r = await call('func', 'POST', `/api/cards/${t.id}/complete`);
    expect(r.status).toBe(200);
    expect(r.body.next.dueDate).toBe(day(7));
    const next = await card('func', r.body.next.id);
    expect(next.card).toMatchObject({ title: 'Relatório semanal', dueDate: day(7), listId: (await card('func', t.id)).card.listId, repeat: { kind: 'dias', n: 7 } });
    expect(next.checklistItems.map((i: any) => [i.text, i.done])).toEqual([['Juntar números', false]]);
    // a concluída deixa de se repetir (quem repete agora é a nova)
    const old = await card('func', t.id);
    expect(old.card.repeat).toBeNull();
    expect(old.card.num).not.toBe(next.card.num);

    // desfazer a conclusão tira a nova (descartada) e a repetição volta para a original
    expect((await call('func', 'POST', `/api/cards/${t.id}/uncomplete`)).status).toBe(200);
    expect((await card('func', r.body.next.id)).card.archivedAt).not.toBeNull();
    expect((await card('func', t.id)).card.repeat).toEqual({ kind: 'dias', n: 7 });
  });

  it('sem repetição, nada nasce; repetição inválida é recusada; tirar a repetição volta ao normal', async () => {
    const t = await newTask(ctx, 'func', 'Uma vez só');
    expect((await call('func', 'POST', `/api/cards/${t.id}/complete`)).body.next).toBeNull();
    const u = await newTask(ctx, 'func', 'Teste');
    expect((await call('func', 'PATCH', `/api/cards/${u.id}`, { repeat: { kind: 'semanal', n: 9 } })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${u.id}`, { repeat: { kind: 'semanal', n: 5 } })).status).toBe(200);
    expect((await call('func', 'PATCH', `/api/cards/${u.id}`, { repeat: null })).status).toBe(200);
    expect((await card('func', u.id)).card.repeat).toBeNull();
  });

  it('tarefa recebida por delegação não se repete', async () => {
    const p = await newTask(ctx, 'gest', 'Conferir caixa');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}`, { repeat: { kind: 'uteis' } })).status).toBe(409);
  });
});
