/** Item 75: as três saídas da tarefa devolvida (Redelegar, Cancelar arquivando a origem e Retomar). */
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

/** O gestor delega uma tarefa nova ao funcionário, que a devolve. */
async function declined(title: string) {
  const p = await newTask(ctx, 'gest', title);
  const d = await delegateTask(ctx, 'gest', p.id, 'func');
  expect((await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Não é comigo' })).status).toBe(200);
  return { p, d };
}
const card = async (who: string, id: string) => (await call(who, 'GET', `/api/cards/${id}`)).body;

describe('cancelar uma devolvida (item 75)', () => {
  it('arquiva também a tarefa de origem; o Desfazer a traz de volta ao mesmo lugar e número', async () => {
    const { p, d } = await declined('Cancelar devolvida');
    const before = (await card('gest', p.id)).card;
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`)).status).toBe(200);
    expect((await card('gest', p.id)).card.archivedAt).not.toBeNull();
    const arch = (await call('gest', 'GET', '/api/archived')).body.items;
    expect(arch.find((i: any) => i.id === p.id)).toMatchObject({ canceled: true, discarded: false });
    const log = (await call('dir', 'GET', `/api/cards/${p.id}/events`)).body.find((e: any) => e.type === 'child_canceled');
    expect(log.after.archived).toBe(true);

    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status).toBe(200);
    const back = (await card('gest', p.id)).card;
    expect(back).toMatchObject({ archivedAt: null, listId: before.listId, num: before.num });
    expect(back.child).toMatchObject({ status: 'DECLINED' });
  });

  it('desarquivar a origem em Arquivadas a devolve ao quadro, livre para delegar de novo', async () => {
    const { p, d } = await declined('Cancelar e desarquivar');
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    expect((await call('gest', 'POST', `/api/cards/${p.id}/unarchive`)).status).toBe(200);
    expect((await card('gest', p.id)).card).toMatchObject({ archivedAt: null, child: null });
    expect((await call('gest', 'POST', `/api/cards/${p.id}/delegate`, { toUserId: ctx.users.func2.id })).status).toBe(200);
  });

  it('em andamento, o Cancelar continua como antes: a origem fica no quadro', async () => {
    const p = await newTask(ctx, 'gest', 'Cancelar em andamento');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    expect((await card('gest', p.id)).card).toMatchObject({ archivedAt: null, child: null });
  });
});

describe('retomar uma devolvida (item 75)', () => {
  it('a origem vai para a caixa de entrada de quem delegou, com a justificativa como comentário, sem avisar quem devolveu', async () => {
    const { p, d } = await declined('Retomar devolvida');
    const notesBefore = (await call('func', 'GET', '/api/notifications')).body.length;
    const r = await call('gest', 'POST', `/api/delegations/${d.delegationId}/resume`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ cardId: p.id, inbox: true });

    const inbox = (await call('gest', 'GET', '/api/inbox')).body;
    expect(inbox.map((c: any) => c.id)).toContain(p.id);
    const got = await card('gest', p.id);
    expect(got.card).toMatchObject({ inInbox: true, archivedAt: null, child: null });
    expect(got.comments.map((c: any) => c.body)).toContain('Devolvida por Func Teste: “Não é comigo”');
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).status).toBe(404);
    expect((await call('func', 'GET', '/api/notifications')).body.length).toBe(notesBefore);
    const over = (await call('gest', 'GET', '/api/delegations')).body;
    expect(over.needAction.map((c: any) => c.id)).not.toContain(d.cardId);
    const log = (await call('dir', 'GET', `/api/cards/${p.id}/events`)).body.map((e: any) => e.type);
    expect(log).toContain('child_resumed');

    // Da caixa de entrada, dá para aceitar num quadro e delegar de novo.
    const board = (await call('gest', 'GET', '/api/boards')).body[0];
    const list = (await call('gest', 'GET', `/api/boards/${board.id}`)).body.lists[0].id;
    expect((await call('gest', 'POST', `/api/cards/${p.id}/accept-delegate`, { listId: list, toUserId: ctx.users.func2.id })).status).toBe(200);
    // Retomar de novo a mesma delegação não funciona.
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/resume`)).status).toBe(409);
  });

  it('só a devolvida pode ser retomada, e só por quem delegou', async () => {
    const p = await newTask(ctx, 'gest', 'Não devolvida');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/resume`)).status).toBe(409);
    const { d: d2 } = await declined('Retomada por outro');
    for (const who of ['func', 'dir', 'gest2', 'admin']) {
      expect((await call(who, 'POST', `/api/delegations/${d2.delegationId}/resume`)).status, who).toBe(404);
    }
  });

  it('a tarefa que o próprio gestor recebeu de cima continua no quadro dele, e o Cancelar não a arquiva', async () => {
    const top = await newTask(ctx, 'dir', 'Veio do diretor');
    const fromDir = await delegateTask(ctx, 'dir', top.id, 'gest');
    await acceptTask(ctx, 'gest', fromDir.cardId);
    const down = await delegateTask(ctx, 'gest', fromDir.cardId, 'func');
    await call('func', 'POST', `/api/cards/${down.cardId}/decline`, { reason: 'Sem tempo agora' });
    const before = (await card('gest', fromDir.cardId)).card;
    const r = await call('gest', 'POST', `/api/delegations/${down.delegationId}/resume`);
    expect(r.body).toMatchObject({ inbox: false });
    expect((await card('gest', fromDir.cardId)).card).toMatchObject({ listId: before.listId, num: before.num, archivedAt: null, child: null });
    expect((await card('gest', fromDir.cardId)).card.delegation.status).toBe('IN_PROGRESS');

    const again = await delegateTask(ctx, 'gest', fromDir.cardId, 'func');
    await call('func', 'POST', `/api/cards/${again.cardId}/decline`, { reason: 'Continua sem tempo' });
    await call('gest', 'POST', `/api/delegations/${again.delegationId}/cancel`);
    expect((await card('gest', fromDir.cardId)).card.archivedAt).toBeNull();
  });
});
