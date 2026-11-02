/**
 * Item 85: fase expandida. A ordem da fase é a prioridade (campo Prioridade da tarefa), ações em massa
 * (com as tarefas que a regra não deixa puladas, com o motivo), fase recolhida e limite de tarefas.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, delegateTask, acceptTask, day, type Ctx } from './helpers.js';

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

const boardOf = async (who: string) => {
  const boards = (await call(who, 'GET', '/api/boards')).body;
  return (await call(who, 'GET', `/api/boards/${boards[0].id}`)).body;
};
/** Fase nova, só deste teste, com as tarefas na ordem dada. */
async function freshList(who: string, name: string, titles: string[]) {
  const b = await boardOf(who);
  const list = (await call(who, 'POST', `/api/boards/${b.id}/lists`, { name })).body;
  const ids: string[] = [];
  for (const t of titles) ids.push((await call(who, 'POST', '/api/cards', { listId: list.id, title: t })).body.id);
  return { listId: list.id as string, ids, boardId: b.id as string };
}
const order = async (who: string, listId: string) =>
  ((await boardOf(who)).cards as any[]).filter((c) => c.listId === listId).sort((a, b) => a.position - b.position).map((c) => c.title as string);

describe('prioridade = posição na fase (item 85)', () => {
  it('a tarefa aberta mostra “Nº de total” e o campo muda a posição, com registro no log', async () => {
    const f = await freshList('gest', 'Prioridade A', ['A', 'B', 'C', 'D', 'E']);
    let d = (await call('gest', 'GET', `/api/cards/${f.ids[3]}`)).body;
    expect(d.priority).toEqual({ listId: f.listId, listName: 'Prioridade A', rank: 4, total: 5 });
    expect((await call('gest', 'POST', `/api/cards/${f.ids[3]}/priority`, { rank: 1 })).body).toEqual({ rank: 1, total: 5 });
    expect(await order('gest', f.listId)).toEqual(['D', 'A', 'B', 'C', 'E']);
    expect((await call('gest', 'POST', `/api/cards/${f.ids[3]}/priority`, { rank: 3 })).status).toBe(200);
    expect(await order('gest', f.listId)).toEqual(['A', 'B', 'D', 'C', 'E']);
    // Além do fim vai para o último lugar.
    expect((await call('gest', 'POST', `/api/cards/${f.ids[0]}/priority`, { rank: 99 })).body.rank).toBe(5);
    expect(await order('gest', f.listId)).toEqual(['B', 'D', 'C', 'E', 'A']);
    d = (await call('gest', 'GET', `/api/cards/${f.ids[3]}`)).body;
    expect(d.priority.rank).toBe(2);
    const log = (await call('ceo', 'GET', `/api/cards/${f.ids[3]}/events`)).body;
    const ev = log.filter((e: any) => e.type === 'priority_changed');
    expect(ev.map((e: any) => [e.before.rank, e.after.rank])).toEqual([[4, 1], [1, 3]]);
  });

  it('mesma posição não muda nada nem entra no log; a caixa de entrada não tem prioridade', async () => {
    const f = await freshList('gest', 'Prioridade B', ['A', 'B']);
    expect((await call('gest', 'POST', `/api/cards/${f.ids[1]}/priority`, { rank: 2 })).body).toEqual({ rank: 2, total: 2 });
    const log = (await call('ceo', 'GET', `/api/cards/${f.ids[1]}/events`)).body;
    expect(log.some((e: any) => e.type === 'priority_changed')).toBe(false);
    const inbox = (await call('gest', 'POST', '/api/capture', { title: 'Na caixa', url: 'https://exemplo.com/85' })).body.id;
    expect((await call('gest', 'GET', `/api/cards/${inbox}`)).body.priority).toBeNull();
    expect((await call('gest', 'POST', `/api/cards/${inbox}/priority`, { rank: 1 })).status).toBe(409);
  });

  it('quem delegou não vê nem muda a prioridade da tarefa do subordinado', async () => {
    const f = await freshList('gest', 'Prioridade C', ['Para o func']);
    const d = await delegateTask(ctx, 'gest', f.ids[0], 'func');
    await acceptTask(ctx, 'func', d.cardId);
    expect((await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.priority).toBeNull();
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/priority`, { rank: 1 })).status).toBe(403);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).body.priority).not.toBeNull();
  });
});

describe('ações em massa (item 85)', () => {
  it('mover para outra fase, no topo ou no fim, mantendo a ordem enviada; "place" desfaz', async () => {
    const f = await freshList('gest', 'Massa origem', ['A', 'B', 'C', 'D']);
    const g = await freshList('gest', 'Massa destino', ['X', 'Y']);
    const before = ((await boardOf('gest')).cards as any[]).filter((c) => f.ids.includes(c.id));
    let r = await call('gest', 'POST', '/api/cards/bulk', { action: 'move', ids: [f.ids[2], f.ids[0]], listId: g.listId, place: 'top' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ done: [f.ids[2], f.ids[0]], skipped: [] });
    expect(await order('gest', g.listId)).toEqual(['C', 'A', 'X', 'Y']);
    expect(await order('gest', f.listId)).toEqual(['B', 'D']);
    r = await call('gest', 'POST', '/api/cards/bulk', { action: 'move', ids: [f.ids[1]], listId: g.listId, place: 'end' });
    expect(await order('gest', g.listId)).toEqual(['C', 'A', 'X', 'Y', 'B']);
    // Para o topo na mesma fase.
    await call('gest', 'POST', '/api/cards/bulk', { action: 'move', ids: [g.ids[1], g.ids[0]], listId: g.listId, place: 'top' });
    expect(await order('gest', g.listId)).toEqual(['Y', 'X', 'C', 'A', 'B']);
    // Desfazer: cada uma volta à fase e à posição de antes.
    r = await call('gest', 'POST', '/api/cards/bulk', {
      action: 'place', items: before.filter((c) => c.title !== 'D').map((c) => ({ id: c.id, listId: c.listId, position: c.position })),
    });
    expect(r.status).toBe(200);
    expect(await order('gest', f.listId)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('prazo e cor de várias de uma vez; inválido não muda nada', async () => {
    const f = await freshList('gest', 'Massa prazo', ['A', 'B']);
    expect((await call('gest', 'POST', '/api/cards/bulk', { action: 'due', items: f.ids.map((id) => ({ id, dueDate: day(3) })) })).body.done).toHaveLength(2);
    expect((await call('gest', 'POST', '/api/cards/bulk', { action: 'color', items: f.ids.map((id) => ({ id, color: 'azul' })) })).body.done).toHaveLength(2);
    const cards = ((await boardOf('gest')).cards as any[]).filter((c) => f.ids.includes(c.id));
    expect(cards.map((c) => [c.dueDate, c.color])).toEqual([[day(3), 'azul'], [day(3), 'azul']]);
    const bad = await call('gest', 'POST', '/api/cards/bulk', { action: 'color', items: [{ id: f.ids[0], color: null }, { id: f.ids[1], color: 'neon' }] });
    expect(bad.body.done).toEqual([f.ids[0]]);
    expect(bad.body.skipped).toEqual([{ id: f.ids[1], title: 'B', reason: 'Cor inválida.' }]);
  });

  it('concluir, arquivar e descartar pulam o que a regra não deixa, com o motivo', async () => {
    const f = await freshList('func', 'Massa regras', ['Minha 1', 'Minha 2']);
    const parent = (await call('gest', 'POST', '/api/cards', { listId: (await boardOf('gest')).lists[0].id, title: 'Vinda do gestor' })).body.id;
    const d = await delegateTask(ctx, 'gest', parent, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', '/api/cards/bulk', { action: 'move', ids: [d.cardId], listId: f.listId, place: 'end' });
    // Descartar: a recebida por delegação é pulada (use Devolver).
    let r = await call('func', 'POST', '/api/cards/bulk', { action: 'discard', ids: [f.ids[0], d.cardId] });
    expect(r.body.done).toEqual([f.ids[0]]);
    expect(r.body.skipped).toHaveLength(1);
    expect(r.body.skipped[0]).toMatchObject({ id: d.cardId, title: 'Vinda do gestor' });
    expect(r.body.skipped[0].reason).toMatch(/Devolver/);
    // Desfazer o descarte: volta à fase.
    await call('func', 'POST', '/api/cards/bulk', { action: 'unarchive', ids: [f.ids[0]] });
    expect(await order('func', f.listId)).toEqual(['Minha 1', 'Minha 2', 'Vinda do gestor']);
    // Arquivar só as concluídas.
    r = await call('func', 'POST', '/api/cards/bulk', { action: 'complete', ids: [f.ids[0], d.cardId] });
    expect(r.body.done).toEqual([f.ids[0], d.cardId]);
    r = await call('func', 'POST', '/api/cards/bulk', { action: 'archive', ids: [f.ids[0], f.ids[1], d.cardId] });
    expect(r.body.done).toEqual([f.ids[0]]);
    expect(r.body.skipped.map((s: any) => s.id)).toEqual([f.ids[1], d.cardId]);
    // Concluída a delegada, o gestor foi avisado para dar o ciente, como na conclusão de uma por uma.
    expect((await call('gest', 'GET', `/api/cards/${parent}`)).body.card.child.status).toBe('AWAITING_ACK');
  });

  it('se uma das tarefas não é da pessoa, nada acontece', async () => {
    const mine = await freshList('gest2', 'Massa minha', ['Minha']);
    const other = await freshList('gest', 'Massa alheia', ['Alheia']);
    const r = await call('gest2', 'POST', '/api/cards/bulk', { action: 'complete', ids: [mine.ids[0], other.ids[0]] });
    expect(r.status).toBe(404);
    expect((await call('gest2', 'GET', `/api/cards/${mine.ids[0]}`)).body.card.completedAt).toBeNull();
    // Destino em fase de outra pessoa também é recusado.
    expect((await call('gest2', 'POST', '/api/cards/bulk', { action: 'move', ids: mine.ids, listId: other.listId, place: 'top' })).status).toBe(404);
    expect((await call('gest2', 'POST', '/api/cards/bulk', { action: 'place', items: [{ id: mine.ids[0], listId: other.listId, position: 1 }] })).status).toBe(404);
    // Repetida na lista também.
    expect((await call('gest2', 'POST', '/api/cards/bulk', { action: 'complete', ids: [mine.ids[0], mine.ids[0]] })).status).toBe(422);
  });
});

describe('fase recolhida e limite (item 85)', () => {
  it('recolher e o limite ficam gravados na fase e voltam no quadro', async () => {
    const f = await freshList('gest', 'Recolher', ['A']);
    expect((await call('gest', 'PATCH', `/api/lists/${f.listId}`, { collapsed: true, cardLimit: 30 })).status).toBe(200);
    let l = (await boardOf('gest')).lists.find((x: any) => x.id === f.listId);
    expect([l.collapsed, l.cardLimit]).toEqual([true, 30]);
    await call('gest', 'PATCH', `/api/lists/${f.listId}`, { collapsed: false, cardLimit: null });
    l = (await boardOf('gest')).lists.find((x: any) => x.id === f.listId);
    expect([l.collapsed, l.cardLimit]).toEqual([false, null]);
    expect((await call('gest', 'PATCH', `/api/lists/${f.listId}`, { cardLimit: 0 })).status).toBe(422);
  });
});
