/**
 * Item 35 (tela "Arquivadas") e item 36 (tarefas em tabela, com filtro por condições e filtros salvos).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, day, type Ctx } from './helpers.js';

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

async function archiveOwn(who: string, title: string) {
  const t = await newTask(ctx, who, title);
  await call(who, 'POST', `/api/cards/${t.id}/complete`);
  expect((await call(who, 'POST', `/api/cards/${t.id}/archive`)).status).toBe(200);
  return t;
}

const table = (who: string, filter: object, extra = '') =>
  call(who, 'GET', `/api/table?filter=${encodeURIComponent(JSON.stringify(filter))}${extra}`);
const titles = (r: { body: any }) => r.body.rows.map((x: any) => x.title).sort();

describe('tarefas arquivadas (item 35)', () => {
  it('lista as próprias e as delegadas com ciente, pesquisa por código e texto e permite desarquivar só as próprias', async () => {
    const own = await archiveOwn('gest', 'Relatório de vendas arquivado');
    await archiveOwn('gest', 'Contrato do galpão');
    // delegada pelo gest e com ciente: aparece para o gest, marcada, e não para o funcionário
    const parent = await newTask(ctx, 'gest', 'Pesquisa de fornecedores');
    const d = await delegateTask(ctx, 'gest', parent.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`);
    // apagada pelo "Desfazer" da criação: não aparece
    const undone = await newTask(ctx, 'gest', 'Criada por engano');
    await call('gest', 'POST', '/api/cards/undo-create', { ids: [undone.id] });

    const all = (await call('gest', 'GET', '/api/archived')).body;
    expect(all.items.map((x: any) => x.title).sort()).toEqual(['Contrato do galpão', 'Pesquisa de fornecedores', 'Relatório de vendas arquivado']);
    const del = all.items.find((x: any) => x.kind === 'delegated');
    expect(del.delegatedTo).toBe('Func Teste');
    expect(del.boardName).toBeNull(); // o quadro do subordinado não aparece
    const mine = all.items.find((x: any) => x.id === own.id);
    expect(mine.kind).toBe('own');
    expect(mine.boardName).toBeTruthy();
    expect(mine.listName).toBeTruthy();

    expect((await call('gest', 'GET', `/api/archived?q=${own.code}`)).body.items.map((x: any) => x.id)).toEqual([own.id]);
    expect((await call('gest', 'GET', `/api/archived?q=${Number(own.code.slice(3))}`)).body.items.map((x: any) => x.id)).toContain(own.id);
    expect((await call('gest', 'GET', '/api/archived?q=galp%C3%A3o')).body.items.map((x: any) => x.title)).toEqual(['Contrato do galpão']);
    expect((await call('gest', 'GET', '/api/archived?q=fornecedores')).body.items).toHaveLength(1);

    // quem recebeu não vê a tarefa arquivada pelo superior; outros não veem nada do gest
    expect((await call('func', 'GET', '/api/archived')).body.items).toEqual([]);
    expect((await call('gest2', 'GET', '/api/archived')).body.items).toEqual([]);

    // desarquivar a própria volta ao quadro; a delegada continua recusada
    expect((await call('gest', 'POST', `/api/cards/${own.id}/unarchive`)).status).toBe(200);
    expect((await call('gest', 'GET', '/api/archived')).body.items.some((x: any) => x.id === own.id)).toBe(false);
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/unarchive`)).status).toBeGreaterThanOrEqual(400);
  });

  it('tarefa apagada pelo "Desfazer" e depois desarquivada volta a contar, na tabela e nas arquivadas', async () => {
    const t = await newTask(ctx, 'gest2', 'Recuperada depois');
    await call('gest2', 'POST', '/api/cards/undo-create', { ids: [t.id] });
    expect((await call('gest2', 'GET', '/api/archived')).body.items).toEqual([]);
    expect((await call('gest2', 'POST', `/api/cards/${t.id}/unarchive`)).status).toBe(200);
    expect(titles(await table('gest2', {}))).toEqual(['Recuperada depois']);
    await call('gest2', 'POST', `/api/cards/${t.id}/complete`);
    await call('gest2', 'POST', `/api/cards/${t.id}/archive`);
    expect((await call('gest2', 'GET', '/api/archived')).body.items.map((x: any) => x.title)).toEqual(['Recuperada depois']);
  });

  it('mostra 50 por vez, da mais recente para a mais antiga', async () => {
    for (let i = 1; i <= 52; i++) await archiveOwn('func2', `Arquivada ${i}`);
    const p1 = (await call('func2', 'GET', '/api/archived')).body;
    expect(p1.items).toHaveLength(50);
    expect(p1.hasMore).toBe(true);
    expect(p1.items[0].title).toBe('Arquivada 52');
    const p2 = (await call('func2', 'GET', '/api/archived?offset=50')).body;
    expect(p2.items.map((x: any) => x.title)).toEqual(['Arquivada 2', 'Arquivada 1']);
    expect(p2.hasMore).toBe(false);
  });
});

describe('tabela com filtros (item 36)', () => {
  beforeAll(async () => {
    const a = await newTask(ctx, 'func3', 'Ligar para o contador', day(-3));
    await call('func3', 'PATCH', `/api/cards/${a.id}`, { description: 'assunto: imposto de renda' });
    await newTask(ctx, 'func3', 'Comprar material', day(2));
    const c = await newTask(ctx, 'func3', 'Enviar proposta', day(20));
    await call('func3', 'POST', `/api/cards/${c.id}/complete`);
    await newTask(ctx, 'func3', 'Sem prazo nenhum');
    const p = await newTask(ctx, 'func3', 'Segredo', day(1));
    await call('func3', 'PATCH', `/api/cards/${p.id}`, { isPrivate: true });
    const arq = await newTask(ctx, 'func3', 'Arquivada da tabela');
    await call('func3', 'POST', `/api/cards/${arq.id}/complete`);
    await call('func3', 'POST', `/api/cards/${arq.id}/archive`);
  });

  it('sem filtro mostra as tarefas da pessoa de todos os quadros, sem as arquivadas, com quadro e fase', async () => {
    const r = await table('func3', {});
    expect(r.status).toBe(200);
    expect(titles(r)).toEqual(['Comprar material', 'Enviar proposta', 'Ligar para o contador', 'Segredo', 'Sem prazo nenhum']);
    expect(r.body.total).toBe(5);
    expect(r.body.rows[0].boardName).toBeTruthy();
    expect(r.body.rows[0].listName).toBeTruthy();
    // prazo crescente, sem prazo por último
    expect(r.body.rows.map((x: any) => x.title)[0]).toBe('Ligar para o contador');
    expect(r.body.rows.at(-1).title).toBe('Sem prazo nenhum');
  });

  it('operadores de texto, data, situação, privada e arquivada', async () => {
    const t = async (f: object) => titles(await table('func3', f));
    expect(await t({ all: [{ field: 'title', op: 'contains', value: 'PROP' }] })).toEqual(['Enviar proposta']);
    expect(await t({ all: [{ field: 'description', op: 'contains', value: 'imposto' }] })).toEqual(['Ligar para o contador']);
    expect(await t({ all: [{ field: 'description', op: 'not_empty' }] })).toEqual(['Ligar para o contador']);
    expect(await t({ all: [{ field: 'due', op: 'before', value: 'today' }] })).toEqual(['Ligar para o contador']);
    expect(await t({ all: [{ field: 'due', op: 'next_days', value: 7 }] })).toEqual(['Comprar material', 'Segredo']);
    expect(await t({ all: [{ field: 'due', op: 'between', value: [day(0), day(30)] }, { field: 'status', op: 'eq', value: 'done' }] })).toEqual(['Enviar proposta']);
    expect(await t({ all: [{ field: 'due', op: 'empty' }] })).toEqual(['Sem prazo nenhum']);
    expect(await t({ all: [{ field: 'created', op: 'last_days', value: 0 }, { field: 'status', op: 'neq', value: 'open' }] })).toEqual(['Enviar proposta']);
    expect(await t({ all: [{ field: 'private', op: 'eq', value: true }] })).toEqual(['Segredo']);
    expect(await t({ all: [{ field: 'archived', op: 'eq', value: true }] })).toEqual(['Arquivada da tabela']);
    expect(await t({ all: [{ field: 'completed', op: 'eq', value: 'today' }] })).toEqual(['Enviar proposta']);
    // OU: atrasadas ou vencem em 7 dias, entre as abertas
    expect(
      await t({ all: [{ field: 'status', op: 'eq', value: 'open' }], any: [{ field: 'due', op: 'before', value: 'today' }, { field: 'due', op: 'next_days', value: 7 }] }),
    ).toEqual(['Comprar material', 'Ligar para o contador', 'Segredo']);
    const code = (await table('func3', { all: [{ field: 'title', op: 'eq', value: 'comprar material' }] })).body.rows[0].code;
    expect(await t({ all: [{ field: 'code', op: 'eq', value: code }] })).toEqual(['Comprar material']);
  });

  it('quadro, fase, delegada para e recebida de', async () => {
    const opts = (await call('gest', 'GET', '/api/table/options')).body;
    expect(opts.boards[0].lists.length).toBeGreaterThan(0);
    expect(opts.delegatedTo.map((x: any) => x.id)).toContain(ctx.users.func.id);
    const parent = await newTask(ctx, 'gest', 'Para o funcionário 2');
    const d = await delegateTask(ctx, 'gest', parent.id, 'func2');
    const to = await table('gest', { all: [{ field: 'delegatedTo', op: 'eq', value: ctx.users.func2.id }] });
    expect(titles(to)).toContain('Para o funcionário 2');
    expect(to.body.rows.find((x: any) => x.title === 'Para o funcionário 2').child.ownerName).toBe('Func2 Teste');
    // na caixa de entrada do funcionário 2, "Recebida de"
    const from = await table('func2', { all: [{ field: 'receivedFrom', op: 'eq', value: ctx.users.gest.id }] });
    expect(from.body.rows.map((x: any) => x.id)).toContain(d.cardId);
    expect(from.body.rows.find((x: any) => x.id === d.cardId).inInbox).toBe(true);
    const list = opts.boards[0].lists[0].id;
    const inList = await table('gest', { all: [{ field: 'list', op: 'eq', value: list }] });
    expect(inList.body.rows.every((x: any) => x.listId === list)).toBe(true);
    const notBoard = await table('gest', { all: [{ field: 'board', op: 'neq', value: opts.boards[0].id }, { field: 'receivedFrom', op: 'empty' }] });
    expect(notBoard.body.rows).toEqual([]);
  });

  it('ordena, pagina e recusa filtro inválido', async () => {
    const r = await table('func3', {}, '&sort=title&dir=desc&limit=2');
    expect(r.body.rows.map((x: any) => x.title)).toEqual(['Sem prazo nenhum', 'Segredo']);
    expect(r.body.total).toBe(5);
    const r2 = await table('func3', {}, '&sort=title&dir=desc&limit=2&offset=4');
    expect(r2.body.rows.map((x: any) => x.title)).toEqual(['Comprar material']);
    expect((await call('func3', 'GET', '/api/table?filter=nao-e-json')).status).toBe(422);
    expect((await table('func3', { all: [{ field: 'title', op: 'before', value: 'x' }] })).status).toBe(422);
    expect((await table('func3', { all: [{ field: 'c.owner_id', op: 'eq', value: 'x' }] })).status).toBe(422);
    expect((await table('func3', { all: [{ field: 'board', op: 'eq', value: "1' OR '1'='1" }] })).status).toBe(422);
    expect((await call('func3', 'GET', '/api/table?sort=c.owner_id')).status).toBe(422);
  });

  it('a tabela nunca mostra tarefas de outra pessoa, nem com filtro', async () => {
    for (const who of ['ceo', 'dir', 'gest2', 'admin']) {
      const r = await table(who, { any: [{ field: 'title', op: 'contains', value: 'Segredo' }, { field: 'archived', op: 'eq', value: true }] });
      expect(r.body.rows.filter((x: any) => x.ownerId !== ctx.users[who].id), who).toEqual([]);
    }
  });

  it('filtros salvos: criar, renomear, trocar condições, excluir; cada um vê só os seus', async () => {
    const f = { all: [{ field: 'status', op: 'eq', value: 'open' }], any: [] };
    const created = await call('func3', 'POST', '/api/filters', { name: '  Abertas  ', filter: f });
    expect(created.status).toBe(200);
    expect(created.body.name).toBe('Abertas');
    expect((await call('func3', 'GET', '/api/filters')).body.map((x: any) => x.name)).toEqual(['Abertas']);
    expect((await call('func2', 'GET', '/api/filters')).body).toEqual([]);
    const id = created.body.id;
    expect((await call('func2', 'PATCH', `/api/filters/${id}`, { name: 'Invasão' })).status).toBe(404);
    expect((await call('func2', 'DELETE', `/api/filters/${id}`)).status).toBe(404);
    const up = await call('func3', 'PATCH', `/api/filters/${id}`, { name: 'Atrasadas', filter: { all: [{ field: 'due', op: 'before', value: 'today' }] } });
    expect(up.body.name).toBe('Atrasadas');
    expect(up.body.filter.all[0].field).toBe('due');
    expect((await call('func3', 'POST', '/api/filters', { name: '', filter: f })).status).toBe(422);
    expect((await call('func3', 'POST', '/api/filters', { name: 'x', filter: { all: [{ field: 'board', op: 'eq', value: 'nao-e-id' }] } })).status).toBe(422);
    expect((await call('func3', 'DELETE', `/api/filters/${id}`)).status).toBe(200);
    expect((await call('func3', 'GET', '/api/filters')).body).toEqual([]);
  });
});
