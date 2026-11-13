/**
 * Item 90 (botão Cobrar na tarefa delegada), item 92 (resumo diário com as delegadas atrasadas) e
 * item 93 (Retomar e Cancelar também na delegação em aberto).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, day, type Ctx } from './helpers.js';
import { runReminders } from '../src/services/reminders.js';
import { tx } from '../src/lib/db.js';

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

const email = (who: string) => ctx.users[who].email;
async function mails(to: string, like = '%') {
  const r = await ctx.pool.query(`SELECT subject, body FROM email_outbox WHERE to_email = $1 AND subject LIKE $2 ORDER BY created_at`, [to, like]);
  return r.rows as { subject: string; body: string }[];
}
const card = async (who: string, id: string) => (await call(who, 'GET', `/api/cards/${id}`)).body;

describe('cobrar a tarefa delegada (item 90)', () => {
  it('quem recebeu ganha balão, aviso e e-mail; a cobrança fica no log e na tarefa', async () => {
    const p = await newTask(ctx, 'gest', 'Relatório de vendas', day(-2));
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    // o balão da delegação já apareceu
    await ctx.pool.query(`UPDATE notifications SET popped_at = now() WHERE user_id = $1`, [ctx.users.func.id]);

    const r = await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, { message: 'Preciso até amanhã cedo' });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(1);

    const me = (await call('func', 'GET', '/api/me')).body;
    expect(me.fresh).toHaveLength(1);
    expect(me.fresh[0]).toMatchObject({ type: 'nudged', cardId: d.cardId });
    expect(me.fresh[0].text).toContain('Gest cobrou (prazo vencido): Relatório de vendas');
    expect(me.fresh[0].text).toContain('Preciso até amanhã cedo');

    const m = await mails(email('func'), '%cobrou%');
    expect(m).toHaveLength(1);
    expect(m[0].subject).toMatch(/^\[#\d+\] Gest cobrou/);

    const c = (await card('func', d.cardId)).card;
    expect(c.delegation).toMatchObject({ nudgeCount: 1, nudgeMessage: 'Preciso até amanhã cedo' });
    expect(c.delegation.nudgedAt).not.toBeNull();
    const parent = (await card('gest', p.id)).card;
    expect(parent.child).toMatchObject({ nudgeCount: 1 });

    const log = (await call('dir', 'GET', `/api/cards/${d.cardId}/events`)).body.find((e: any) => e.type === 'nudged');
    expect(log.after).toMatchObject({ to: 'Func Teste', count: 1, message: 'Preciso até amanhã cedo' });
  });

  it('não deixa cobrar de novo antes de 1 hora; depois conta a segunda vez', async () => {
    const p = await newTask(ctx, 'gest', 'Cobrar duas vezes');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, {})).status).toBe(200);
    const again = await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, {});
    expect(again.status).toBe(409);
    expect(again.body.error).toContain('1 hora');
    await ctx.pool.query(`UPDATE delegations SET nudged_at = now() - interval '61 minutes' WHERE id = $1`, [d.delegationId]);
    const r = await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, {});
    expect(r.body.count).toBe(2);
    // sem recado, a mensagem anterior não fica valendo
    expect((await card('func', d.cardId)).card.delegation.nudgeMessage).toBeNull();
  });

  it('só quem delegou cobra, e só a tarefa em aberto', async () => {
    const p = await newTask(ctx, 'gest', 'Só o delegador');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    for (const who of ['func', 'dir', 'gest2', 'admin']) {
      expect((await call(who, 'POST', `/api/delegations/${d.delegationId}/nudge`, {})).status, who).toBe(404);
    }
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, {})).status).toBe(409);
    const p2 = await newTask(ctx, 'gest', 'Devolvida não se cobra');
    const d2 = await delegateTask(ctx, 'gest', p2.id, 'func');
    await call('func', 'POST', `/api/cards/${d2.cardId}/decline`, { reason: 'Não é comigo' });
    expect((await call('gest', 'POST', `/api/delegations/${d2.delegationId}/nudge`, {})).status).toBe(409);
  });

  it('redelegar zera as cobranças', async () => {
    const p = await newTask(ctx, 'gest', 'Zera ao redelegar');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/nudge`, {});
    await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Sem tempo' });
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/redelegate`, { toUserId: ctx.users.func2.id });
    expect((await card('func2', d.cardId)).card.delegation).toMatchObject({ nudgeCount: 0, nudgedAt: null });
  });
});

describe('resumo diário com as delegadas atrasadas (item 92)', () => {
  it('quem delegou vê as atrasadas de cada pessoa; quem recebeu vê de quem é', async () => {
    const MONDAY = new Date('2030-01-07T10:30:00Z');
    const p = await newTask(ctx, 'gest2', 'Delegada atrasada no resumo', '2030-01-03');
    const d = await delegateTask(ctx, 'gest2', p.id, 'func3');
    await acceptTask(ctx, 'func3', d.cardId);
    await call('gest2', 'POST', `/api/delegations/${d.delegationId}/nudge`, {});
    const p2 = await newTask(ctx, 'gest2', 'Delegada no prazo', '2030-02-01');
    await delegateTask(ctx, 'gest2', p2.id, 'func3');

    await tx(ctx.pool, (db) => runReminders(db, MONDAY));
    const g = (await mails(email('gest2'), 'Resumo do dia%'))[0];
    expect(g.subject).toContain('1 delegada atrasada');
    expect(g.body).toContain('Delegadas por você e atrasadas');
    expect(g.body).toMatch(/#\d+ Delegada atrasada no resumo \(com Func3, prazo 03\/01\/2030, cobrada em \d\d\/\d\d\)/);
    expect(g.body).toContain(`/#/tarefa/${p.id}`);
    expect(g.body).not.toContain('Delegada no prazo');

    const f = (await mails(email('func3'), 'Resumo do dia%'))[0];
    expect(f.body).toContain('Delegada atrasada no resumo (prazo 03/01/2030, delegada por Gest2)');
  });
});

describe('Retomar e Cancelar na delegação em aberto (item 93)', () => {
  it('Retomar: a pessoa é avisada, a tarefa sai do quadro dela e a origem continua no quadro de quem delegou', async () => {
    const p = await newTask(ctx, 'gest', 'Retomar em andamento');
    const before = (await card('gest', p.id)).card;
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const r = await call('gest', 'POST', `/api/delegations/${d.delegationId}/resume`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ cardId: p.id, inbox: false });
    const back = (await card('gest', p.id)).card;
    expect(back).toMatchObject({ archivedAt: null, listId: before.listId, child: null });
    expect((await ctx.pool.query('SELECT archived_at FROM cards WHERE id = $1', [d.cardId])).rows[0].archived_at).not.toBeNull();
    const n = (await call('func', 'GET', '/api/notifications')).body;
    expect(JSON.stringify(n)).toContain('Gest retomou a tarefa: você não precisa mais fazê-la');
    const types = (await call('dir', 'GET', `/api/cards/${p.id}/events`)).body.map((e: any) => e.type);
    expect(types).toContain('child_resumed');
    // livre para delegar de novo
    expect((await call('gest', 'POST', `/api/cards/${p.id}/delegate`, { toUserId: ctx.users.func2.id })).status).toBe(200);
  });

  it('Retomar também funciona com a tarefa ainda na caixa de entrada da pessoa', async () => {
    const p = await newTask(ctx, 'gest', 'Retomar da caixa');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/resume`)).status).toBe(200);
    expect((await call('func', 'GET', '/api/inbox')).body.find((c: any) => c.id === d.cardId)).toBeUndefined();
  });

  it('Cancelar: desiste da tarefa; a pessoa é avisada e a origem vai para Arquivadas', async () => {
    const p = await newTask(ctx, 'gest', 'Desistir da delegada');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    const r = await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    expect(r.body).toMatchObject({ ok: true, parentArchived: true });
    expect((await card('gest', p.id)).card.archivedAt).not.toBeNull();
    const n = (await call('func', 'GET', '/api/notifications')).body;
    expect(JSON.stringify(n)).toContain('Gest cancelou a delegação: você não precisa mais fazer esta tarefa');
  });
});
