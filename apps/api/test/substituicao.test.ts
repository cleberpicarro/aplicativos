/**
 * Item 72: substituição em férias e ausências. O substituto troca para a pessoa no seletor do topo
 * (cabeçalho X-SyncTasks-Como) e gerencia quadros, caixa de entrada e delegações dela:
 * privadas nunca; comuns só se ela compartilhou; nada de log, avisos, dados pessoais ou administração.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, day, type Ctx } from './helpers.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;
const s: Record<string, string> = {};

/** Pedido do substituto `who` agindo como `as`. */
async function como(who: string, as: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  const r = await ctx.app.inject({
    method,
    url,
    headers: { cookie: ctx.users[who].cookie, 'x-synctasks': '1', 'x-synctasks-como': ctx.users[as].id },
    payload: payload as any,
  });
  let body: any = null;
  try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body };
}
const ids = (cards: any[]) => cards.map((c) => c.id as string);
const startSub = (by: string, body: object) => call(by, 'POST', '/api/substitution', body);

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
  // Tarefas do gestor: comum, privada, delegada (aguardando ciente), capturada por ele e transferida por um colega.
  const own = await newTask(ctx, 'gest', 'Comum do gestor');
  s.own = own.id; s.list = own.listId;
  s.board = (await call('gest', 'GET', '/api/boards')).body[0].id;
  const priv = await newTask(ctx, 'gest', 'Exame do gestor');
  await call('gest', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
  s.priv = priv.id;
  const parent = await newTask(ctx, 'gest', 'Relatório para o funcionário');
  const d = await delegateTask(ctx, 'gest', parent.id, 'func');
  await acceptTask(ctx, 'func', d.cardId);
  await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
  s.parent = parent.id; s.child = d.cardId; s.deleg = d.delegationId;
  s.captured = (await call('gest', 'POST', '/api/capture', { title: 'Anotação do gestor', url: 'https://exemplo.com/x' })).body.id;
  const t = await newTask(ctx, 'gest2', 'Veio do colega');
  await call('gest2', 'POST', `/api/cards/${t.id}/transfer`, { toUserId: ctx.users.gest.id });
  s.transferred = t.id;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

describe('substituição em férias (item 72)', () => {
  it('lista quem pode substituir: nem a própria pessoa, nem a equipe dela, nem quem está fora da hierarquia', async () => {
    const r = await call('gest', 'GET', '/api/substitution');
    expect(r.status).toBe(200);
    expect(r.body.current).toBeNull();
    const names = r.body.candidates.map((c: any) => c.id);
    expect(names).toContain(ctx.users.gest2.id);
    expect(names).toContain(ctx.users.dir.id);
    expect(names).toContain(ctx.users.func3.id);
    for (const no of ['gest', 'func', 'func2', 'admin']) expect(names, no).not.toContain(ctx.users[no].id);
    // Alguém da equipe é recusado também pelo servidor.
    expect((await startSub('gest', { substituteId: ctx.users.func.id, shareCommon: false })).status).toBe(422);
    // Data de volta no passado.
    expect((await startSub('gest', { substituteId: ctx.users.gest2.id, shareCommon: false, endsOn: day(-1) })).status).toBe(422);
    // Ninguém liga a substituição de outra pessoa, a não ser a administração.
    expect((await startSub('dir', { userId: ctx.users.gest.id, substituteId: ctx.users.gest2.id, shareCommon: false })).status).toBe(403);
    expect((await call('dir', 'GET', `/api/substitution?userId=${ctx.users.gest.id}`)).status).toBe(403);
  });

  it('sem substituição ligada, o seletor não funciona', async () => {
    expect((await como('gest2', 'gest', 'GET', '/api/boards')).status).toBe(403);
    expect((await como('func3', 'gest', 'GET', '/api/inbox')).status).toBe(403);
  });

  it('sem compartilhar: o substituto vê os quadros, as delegações e o que chegou de outras pessoas; nunca a privada nem as comuns', async () => {
    const r = await startSub('gest', { substituteId: ctx.users.gest2.id, shareCommon: false, endsOn: day(10) });
    expect(r.status).toBe(200);
    expect(r.body.substitute.id).toBe(ctx.users.gest2.id);
    // O substituto é avisado.
    const n = (await call('gest2', 'GET', '/api/notifications')).body;
    expect(n.some((x: any) => x.type === 'substitution_started')).toBe(true);
    // O seletor aparece para quem substitui.
    const me = (await call('gest2', 'GET', '/api/me')).body;
    expect(me.substitution.covering.map((c: any) => c.id)).toEqual([ctx.users.gest.id]);
    expect((await call('gest', 'GET', '/api/me')).body.substitution.mine.substitute.id).toBe(ctx.users.gest2.id);

    // Agindo como o gestor.
    const asMe = (await como('gest2', 'gest', 'GET', '/api/me')).body;
    expect(asMe.user.id).toBe(ctx.users.gest.id);
    expect(asMe.user.isAdmin).toBe(false);
    expect(asMe.substitution.acting).toMatchObject({ id: ctx.users.gest.id, shareCommon: false, by: { id: ctx.users.gest2.id } });
    expect(asMe.substitution.covering.map((c: any) => c.id)).toEqual([ctx.users.gest.id]);
    expect(asMe.counts.inbox).toBe(1);

    const boards = (await como('gest2', 'gest', 'GET', '/api/boards')).body;
    expect(boards.map((b: any) => b.id)).toContain(s.board);
    const board = (await como('gest2', 'gest', 'GET', `/api/boards/${s.board}`)).body;
    expect(ids(board.cards)).toEqual([s.parent]);
    expect(ids((await como('gest2', 'gest', 'GET', '/api/inbox')).body)).toEqual([s.transferred]);

    for (const hidden of [s.own, s.priv, s.captured]) {
      expect((await como('gest2', 'gest', 'GET', `/api/cards/${hidden}`)).status, hidden).toBe(404);
      expect((await como('gest2', 'gest', 'PATCH', `/api/cards/${hidden}`, { title: 'mexido' })).status, hidden).toBe(404);
    }
    for (const q of ['Comum', 'Exame', 'Anotação']) {
      expect((await como('gest2', 'gest', 'GET', `/api/search?q=${encodeURIComponent(q)}`)).body.results, q).toHaveLength(0);
    }
    const table = (await como('gest2', 'gest', 'GET', '/api/table')).body;
    expect(ids(table.rows).sort()).toEqual([s.parent, s.transferred].sort());
    const del = JSON.stringify((await como('gest2', 'gest', 'GET', '/api/delegations')).body);
    expect(del.includes('Relatório para o funcionário')).toBe(true);
  });

  it('o substituto age pela pessoa: dá ciente, cria, delega e comenta; o log e o comentário mostram quem fez', async () => {
    expect((await como('gest2', 'gest', 'POST', `/api/delegations/${s.deleg}/ack`)).status).toBe(200);
    // Tarefa nova no quadro do gestor: fica visível para o substituto, mesmo sem compartilhar.
    const created = await como('gest2', 'gest', 'POST', '/api/cards', { listId: s.list, title: 'Nova pelo substituto' });
    expect(created.status).toBe(200);
    const board = (await como('gest2', 'gest', 'GET', `/api/boards/${s.board}`)).body;
    expect(ids(board.cards)).toContain(created.body.id);
    const d = await como('gest2', 'gest', 'POST', `/api/cards/${created.body.id}/delegate`, { toUserId: ctx.users.func2.id, note: 'Pode fazer até sexta?' });
    expect(d.status).toBe(200);
    // Para quem recebe, a delegação vem do gestor.
    const child = (await call('func2', 'GET', `/api/cards/${d.body.cardId}`)).body;
    expect(child.card.delegation.delegatorId).toBe(ctx.users.gest.id);
    expect(child.comments[0]).toMatchObject({ authorName: 'Gest Teste', viaName: 'Gest2 Teste' });
    // O log (visto pela diretoria) registra o substituto.
    const log = (await call('dir', 'GET', `/api/cards/${created.body.id}/events`)).body;
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((e: any) => e.via_name === 'Gest2 Teste')).toBe(true);
    // O que o próprio gestor faz não tem "via".
    const own = (await call('dir', 'GET', `/api/cards/${s.own}/events`)).body;
    expect(own.every((e: any) => e.via_name === null)).toBe(true);
  });

  it('o substituto não usa log, avisos, dados pessoais, exportação, administração nem muda a privacidade', async () => {
    const blocked: [string, string, unknown?][] = [
      ['GET', `/api/cards/${s.parent}/events`],
      ['GET', '/api/notifications'],
      ['POST', '/api/notifications/read', {}],
      ['PATCH', '/api/me/prefs', { emailDigest: false }],
      ['GET', '/api/me/assistants'],
      ['GET', '/api/export'],
      ['POST', '/api/capture', { title: 'x', url: 'https://exemplo.com' }],
      ['GET', '/api/substitution'],
      ['POST', '/api/substitution/end', {}],
      ['GET', '/api/admin/users'],
    ];
    for (const [m, url, body] of blocked) expect((await como('gest2', 'gest', m as any, url, body)).status, `${m} ${url}`).toBe(403);
    expect((await como('gest2', 'gest', 'PATCH', `/api/cards/${s.parent}`, { isPrivate: true })).status).toBe(403);
    // O próprio gestor continua usando tudo normalmente.
    expect((await call('gest', 'GET', '/api/notifications')).status).toBe(200);
  });

  it('compartilhando: as comuns aparecem, a privada continua escondida', async () => {
    expect((await startSub('gest', { substituteId: ctx.users.gest2.id, shareCommon: true })).status).toBe(200);
    const board = (await como('gest2', 'gest', 'GET', `/api/boards/${s.board}`)).body;
    expect(ids(board.cards)).toContain(s.own);
    expect(ids(board.cards)).not.toContain(s.priv);
    expect(ids((await como('gest2', 'gest', 'GET', '/api/inbox')).body).sort()).toEqual([s.captured, s.transferred].sort());
    expect((await como('gest2', 'gest', 'GET', `/api/cards/${s.priv}`)).status).toBe(404);
    expect((await como('gest2', 'gest', 'GET', '/api/search?q=Exame')).body.results).toHaveLength(0);
    const f = encodeURIComponent(JSON.stringify({ any: [{ field: 'archived', op: 'eq', value: true }, { field: 'archived', op: 'eq', value: false }] }));
    expect(JSON.stringify((await como('gest2', 'gest', 'GET', `/api/table?filter=${f}`)).body).includes('Exame')).toBe(false);
  });

  it('acaba ao encerrar, ao passar do último dia ou se outra pessoa assumir; a administração liga por quem saiu de surpresa', async () => {
    expect((await call('gest', 'POST', '/api/substitution/end', {})).status).toBe(200);
    expect((await como('gest2', 'gest', 'GET', '/api/boards')).status).toBe(403);
    expect((await call('gest2', 'GET', '/api/me')).body.substitution.covering).toEqual([]);

    // Administração liga pela pessoa.
    const r = await startSub('admin', { userId: ctx.users.gest.id, substituteId: ctx.users.dir.id, shareCommon: false });
    expect(r.status).toBe(200);
    expect((await call('admin', 'GET', `/api/substitution?userId=${ctx.users.gest.id}`)).body.current.substitute.id).toBe(ctx.users.dir.id);
    expect((await como('dir', 'gest', 'GET', '/api/inbox')).status).toBe(200);
    const n = (await call('gest', 'GET', '/api/notifications')).body;
    expect(n.some((x: any) => x.type === 'substitution_started')).toBe(true);

    // Trocar o substituto encerra o anterior.
    expect((await startSub('gest', { substituteId: ctx.users.gest2.id, shareCommon: false })).status).toBe(200);
    expect((await como('dir', 'gest', 'GET', '/api/inbox')).status).toBe(403);
    expect((await como('gest2', 'gest', 'GET', '/api/inbox')).status).toBe(200);

    // Passou do último dia: acaba sozinha.
    await ctx.pool.query(`UPDATE substitutions SET ends_on = $2 WHERE absent_id = $1 AND ended_at IS NULL`, [ctx.users.gest.id, day(-1)]);
    expect((await como('gest2', 'gest', 'GET', '/api/inbox')).status).toBe(403);
    expect((await call('gest', 'GET', '/api/me')).body.substitution.mine).toBeNull();
    // E dá para ligar de novo.
    expect((await startSub('gest', { substituteId: ctx.users.gest2.id, shareCommon: false, endsOn: day(0) })).status).toBe(200);
    expect((await como('gest2', 'gest', 'GET', '/api/inbox')).status).toBe(200);
  });
});
