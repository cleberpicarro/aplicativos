/**
 * Item 82: descartar, de dentro da tarefa, uma tarefa própria e aberta do quadro (por exemplo, criada por engano).
 * Ela vai para Arquivadas como "descartada", sem concluir, e volta à mesma fase e posição, com o mesmo número.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, type Ctx } from './helpers.js';

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

const boardCards = async (who: string, listId: string) => {
  const boards = (await call(who, 'GET', '/api/boards')).body;
  const board = (await call(who, 'GET', `/api/boards/${boards[0].id}`)).body;
  return (board.cards as any[]).filter((c) => c.listId === listId).sort((a, b) => a.position - b.position).map((c) => c.id as string);
};

describe('descartar tarefa do quadro (item 82)', () => {
  it('sai do quadro sem concluir, aparece em Arquivadas como descartada do quadro e o log registra', async () => {
    const t = await newTask(ctx, 'gest', 'Teste criado por engano');
    const r = await call('gest', 'POST', `/api/cards/${t.id}/discard`);
    expect(r.status).toBe(200);
    expect(await boardCards('gest', t.listId)).not.toContain(t.id);
    const card = (await call('gest', 'GET', `/api/cards/${t.id}`)).body.card;
    expect(card.archivedAt).not.toBeNull();
    expect(card.completedAt).toBeNull();
    const arch = (await call('gest', 'GET', '/api/archived?q=engano')).body.items;
    expect(arch).toHaveLength(1);
    expect(arch[0].discarded).toBe(true);
    expect(arch[0].boardName).not.toBeNull();
    const log = (await call('ceo', 'GET', `/api/cards/${t.id}/events`)).body;
    const ev = log.find((e: any) => e.type === 'discarded');
    expect(ev?.after?.board).toBe(true);
  });

  it('desarquivar (o Desfazer do aviso) devolve à mesma fase e posição, com o mesmo número', async () => {
    const a = await newTask(ctx, 'gest2', 'Primeira');
    const b = await newTask(ctx, 'gest2', 'Do meio');
    await newTask(ctx, 'gest2', 'Última');
    const before = await boardCards('gest2', a.listId);
    expect((await call('gest2', 'POST', `/api/cards/${b.id}/discard`)).status).toBe(200);
    expect((await call('gest2', 'POST', `/api/cards/${b.id}/unarchive`)).status).toBe(200);
    expect(await boardCards('gest2', a.listId)).toEqual(before);
    const card = (await call('gest2', 'GET', `/api/cards/${b.id}`)).body.card;
    expect(card.num).toBe(b.num);
    expect(card.archivedAt).toBeNull();
    // Descartada de novo depois de desarquivada, volta a contar como descartada.
    await call('gest2', 'POST', `/api/cards/${b.id}/discard`);
    const arch = (await call('gest2', 'GET', '/api/archived?q=meio')).body.items;
    expect(arch[0].discarded).toBe(true);
  });

  it('a concluída se arquiva (não se descarta) e a arquivada não se descarta de novo', async () => {
    const t = await newTask(ctx, 'gest3', 'Já feita');
    await call('gest3', 'POST', `/api/cards/${t.id}/complete`);
    const r = await call('gest3', 'POST', `/api/cards/${t.id}/discard`);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Arquivar/);
    await call('gest3', 'POST', `/api/cards/${t.id}/archive`);
    expect((await call('gest3', 'POST', `/api/cards/${t.id}/discard`)).status).toBe(409);
    const arch = (await call('gest3', 'GET', '/api/archived?q=feita')).body.items;
    expect(arch[0].discarded).toBe(false);
  });

  it('recebida por delegação se devolve; com delegação em aberto, cancela-se antes', async () => {
    const parent = await newTask(ctx, 'gest', 'Repassada ao funcionário');
    const d = await delegateTask(ctx, 'gest', parent.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const recv = await call('func', 'POST', `/api/cards/${d.cardId}/discard`);
    expect(recv.status).toBe(409);
    expect(recv.body.error).toMatch(/Devolver/);
    const open = await call('gest', 'POST', `/api/cards/${parent.id}/discard`);
    expect(open.status).toBe(409);
    expect(open.body.error).toMatch(/delegação em aberto/);
  });

  it('ninguém descarta tarefa de outra pessoa', async () => {
    const t = await newTask(ctx, 'func2', 'Do funcionário');
    for (const who of ['gest', 'ceo', 'func']) {
      expect([403, 404]).toContain((await call(who, 'POST', `/api/cards/${t.id}/discard`)).status);
    }
    expect((await call('func2', 'GET', `/api/cards/${t.id}`)).body.card.archivedAt).toBeNull();
  });

  it('na caixa de entrada, a mesma rota descarta como no item 50', async () => {
    const c = (await call('gest', 'POST', '/api/capture', { title: 'Capturada', url: 'https://exemplo.com/x' })).body;
    expect((await call('gest', 'POST', `/api/cards/${c.id}/discard`)).status).toBe(200);
    expect((await call('gest', 'GET', `/api/cards/${c.id}`)).body.card.discarded).toBe(true);
  });
});
