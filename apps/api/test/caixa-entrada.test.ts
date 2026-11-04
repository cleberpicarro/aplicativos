/**
 * Item 50: na caixa de entrada, além de aceitar, dá para delegar direto (aceite e delegação de uma vez)
 * e descartar (sem concluir), uma ou várias de uma vez, com desfazer.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, firstListOf, type Ctx } from './helpers.js';

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

const capture = async (who: string, title: string) =>
  (await call(who, 'POST', '/api/capture', { title, url: `https://exemplo.com/${encodeURIComponent(title)}` })).body as { id: string; num: number };
const inboxIds = async (who: string) => (await call(who, 'GET', '/api/inbox')).body.map((c: any) => c.id) as string[];

describe('descartar da caixa de entrada (item 50)', () => {
  it('descarta várias de uma vez: saem da caixa, vão para Arquivadas como descartadas e o log registra', async () => {
    const a = await capture('gest', 'Descartar A');
    const b = await capture('gest', 'Descartar B');
    const keep = await capture('gest', 'Fica na caixa');
    const r = await call('gest', 'POST', '/api/inbox/discard', { ids: [a.id, b.id, a.id] });
    expect(r.status).toBe(200);
    expect(r.body.discarded).toBe(2);
    const ids = await inboxIds('gest');
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids).toContain(keep.id);
    const me = (await call('gest', 'GET', '/api/me')).body;
    expect(me.counts.inbox).toBe(ids.length);
    const card = (await call('gest', 'GET', `/api/cards/${a.id}`)).body.card;
    expect(card.discarded).toBe(true);
    expect(card.completedAt).toBeNull();
    expect(card.archivedAt).not.toBeNull();
    const arch = (await call('gest', 'GET', '/api/archived?q=Descartar')).body.items;
    expect(arch.map((x: any) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(arch.every((x: any) => x.discarded && x.kind === 'own')).toBe(true);
    const log = (await call('ceo', 'GET', `/api/cards/${a.id}/events`)).body;
    expect(log.map((e: any) => e.type)).toContain('discarded');
  });

  it('desfazer e desarquivar devolvem a tarefa para a caixa de entrada, com o mesmo número', async () => {
    const a = await capture('gest2', 'Volta pelo desfazer');
    const b = await capture('gest2', 'Volta pelo desarquivar');
    await call('gest2', 'POST', '/api/inbox/discard', { ids: [a.id, b.id] });
    expect((await call('gest2', 'POST', '/api/inbox/restore', { ids: [a.id] })).status).toBe(200);
    expect((await call('gest2', 'POST', `/api/cards/${b.id}/unarchive`)).status).toBe(200);
    const inbox = (await call('gest2', 'GET', '/api/inbox')).body;
    for (const t of [a, b]) {
      const c = inbox.find((x: any) => x.id === t.id);
      expect(c.inInbox).toBe(true);
      expect(c.num).toBe(t.num);
      expect(c.listId).toBeNull();
    }
    // Restaurar o que não está descartado é recusado.
    expect((await call('gest2', 'POST', '/api/inbox/restore', { ids: [a.id] })).status).toBe(409);
  });

  it('tarefa recebida por delegação não se descarta (devolve-se); e é tudo ou nada', async () => {
    const own = await capture('func', 'Minha capturada');
    const t = await newTask(ctx, 'gest', 'Delegada para descartar');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    const r = await call('func', 'POST', '/api/inbox/discard', { ids: [own.id, d.cardId] });
    expect(r.status).toBe(409);
    expect(r.body.error ?? r.body.message).toMatch(/Devolver/);
    const ids = await inboxIds('func');
    expect(ids).toContain(own.id);
    expect(ids).toContain(d.cardId);
    // Tarefa que já está num quadro também não.
    const onBoard = await newTask(ctx, 'func', 'No quadro');
    expect((await call('func', 'POST', '/api/inbox/discard', { ids: [onBoard.id] })).status).toBe(409);
  });

  it('a tarefa transferida para a caixa (por exemplo, de quem foi desativado) pode ser descartada', async () => {
    const t = await newTask(ctx, 'func3', 'Transferida para o gestor');
    expect((await call('func3', 'POST', `/api/cards/${t.id}/transfer`, { toUserId: ctx.users.gest2.id })).status).toBe(200);
    expect((await call('gest2', 'POST', '/api/inbox/discard', { ids: [t.id] })).status).toBe(200);
    expect(await inboxIds('gest2')).not.toContain(t.id);
    // Quem transferiu não vê mais a tarefa e não é avisado.
    expect((await call('func3', 'GET', `/api/cards/${t.id}`)).status).toBe(404);
  });

  it('ninguém descarta nem restaura tarefa de outra pessoa', async () => {
    const mine = await capture('gest', 'Do gestor, não mexa');
    for (const who of ['ceo', 'dir', 'gest2', 'func']) {
      const r = await call(who, 'POST', '/api/inbox/discard', { ids: [mine.id] });
      expect(r.status, who).toBeGreaterThanOrEqual(403);
      expect(r.status, who).toBeLessThan(500);
    }
    expect(await inboxIds('gest')).toContain(mine.id);
  });
});

describe('delegar direto da caixa de entrada (item 50)', () => {
  it('aceita no quadro escolhido e delega na mesma ação; o subordinado recebe na caixa dele', async () => {
    const cap = await capture('gest', 'Repassar ao funcionário');
    const listId = await firstListOf(ctx, 'gest');
    const r = await call('gest', 'POST', `/api/cards/${cap.id}/accept-delegate`, { listId, toUserId: ctx.users.func2.id, note: 'Cuide disso' });
    expect(r.status).toBe(200);
    const mine = (await call('gest', 'GET', `/api/cards/${cap.id}`)).body.card;
    expect(mine.listId).toBe(listId);
    expect(mine.child.cardId).toBe(r.body.cardId);
    expect(await inboxIds('gest')).not.toContain(cap.id);
    expect(await inboxIds('func2')).toContain(r.body.cardId);
  });

  it('a tarefa que chegou por delegação também pode ser aceita e repassada para baixo de uma vez', async () => {
    const t = await newTask(ctx, 'dir', 'Do diretor para o gestor');
    const d = await delegateTask(ctx, 'dir', t.id, 'gest');
    const listId = await firstListOf(ctx, 'gest');
    const r = await call('gest', 'POST', `/api/cards/${d.cardId}/accept-delegate`, { listId, toUserId: ctx.users.func.id });
    expect(r.status).toBe(200);
    const seen = (await call('dir', 'GET', `/api/cards/${t.id}`)).body.card;
    expect(seen.child.status).toBe('IN_PROGRESS');
  });

  it('se a delegação é recusada, o aceite também é desfeito (a tarefa continua na caixa)', async () => {
    const cap = await capture('gest', 'Para fora da equipe');
    const listId = await firstListOf(ctx, 'gest');
    const r = await call('gest', 'POST', `/api/cards/${cap.id}/accept-delegate`, { listId, toUserId: ctx.users.func3.id });
    expect(r.status).toBe(403);
    expect(await inboxIds('gest')).toContain(cap.id);
    // "Não pode ser repassada": nem aceitando junto.
    const t = await newTask(ctx, 'dir', 'Faça você mesmo');
    const d = await delegateTask(ctx, 'dir', t.id, 'gest', { noPass: true });
    const r2 = await call('gest', 'POST', `/api/cards/${d.cardId}/accept-delegate`, { listId, toUserId: ctx.users.func.id });
    expect(r2.status).toBe(409);
    expect(await inboxIds('gest')).toContain(d.cardId);
    const del = await ctx.pool.query('SELECT status FROM delegations WHERE card_id = $1', [d.cardId]);
    expect(del.rows[0].status).toBe('PENDING_ACCEPT');
  });

  it('não serve para tarefa que já está num quadro nem para tarefa de outra pessoa', async () => {
    const onBoard = await newTask(ctx, 'gest', 'Já no quadro');
    const listId = await firstListOf(ctx, 'gest');
    expect((await call('gest', 'POST', `/api/cards/${onBoard.id}/accept-delegate`, { listId, toUserId: ctx.users.func.id })).status).toBe(409);
    const other = await capture('gest2', 'Do outro gestor');
    expect((await call('gest', 'POST', `/api/cards/${other.id}/accept-delegate`, { listId, toUserId: ctx.users.func.id })).status).toBe(404);
  });
});
