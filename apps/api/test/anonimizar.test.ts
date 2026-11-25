/**
 * Item 118 (F7 da revisão geral): exportar os dados de quem saiu e anonimizar (LGPD), sem quebrar o log.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, type Ctx } from './helpers.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;
const s: Record<string, string> = {};

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
  // func3: uma tarefa comum, uma privada com checklist e uma recebida do gestor 2 (concluída e com ciente).
  const own = await newTask(ctx, 'func3', 'Planilha comum');
  s.own = own.id;
  const priv = await newTask(ctx, 'func3', 'Consulta médica');
  await call('func3', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
  await call('func3', 'POST', `/api/cards/${priv.id}/checklist`, { text: 'Levar exames' });
  s.priv = priv.id;
  const parent = await newTask(ctx, 'gest2', 'Relatório do mês');
  const d = await delegateTask(ctx, 'gest2', parent.id, 'func3');
  await acceptTask(ctx, 'func3', d.cardId);
  await call('func3', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'Comecei hoje' });
  await call('func3', 'POST', `/api/cards/${d.cardId}/complete`);
  await call('gest2', 'POST', `/api/delegations/${d.delegationId}/ack`);
  s.child = d.cardId;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

describe('exportar e anonimizar quem saiu (item 118)', () => {
  it('exportar traz cadastro, tarefas (com privadas e checklist) e comentários', async () => {
    const r = await call('admin', 'GET', `/api/admin/users/${ctx.users.func3.id}/export`);
    expect(r.status).toBe(200);
    expect(r.body.person.email).toBe(ctx.users.func3.email);
    const titles = r.body.tasks.map((t: any) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Planilha comum', 'Consulta médica']));
    expect(r.body.tasks.find((t: any) => t.title === 'Consulta médica').checklist[0].text).toBe('Levar exames');
  });

  it('só anonimiza quem já está inativo; depois não dá para reativar nem anonimizar de novo', async () => {
    const id = ctx.users.func3.id;
    expect((await call('admin', 'POST', `/api/admin/users/${id}/anonymize`)).status).toBe(409);
    expect((await call('admin', 'POST', `/api/admin/users/${id}/deactivate`, { successorId: ctx.users.func2.id })).status).toBe(200);
    const r = await call('admin', 'POST', `/api/admin/users/${id}/anonymize`);
    expect(r.status).toBe(200);
    expect(r.body.privateTasks).toBe(1);
    expect((await call('admin', 'POST', `/api/admin/users/${id}/anonymize`)).status).toBe(409);
    expect((await call('admin', 'POST', `/api/admin/users/${id}/active`, { active: true })).status).toBe(409);

    const u = (await ctx.pool.query('SELECT name, email, password_hash, anonymized_at FROM users WHERE id = $1', [id])).rows[0];
    expect(u.name).toBe('Usuário removido');
    expect(u.email).not.toContain(ctx.users.func3.email.split('@')[0]);
    expect(u.password_hash).toBeNull();
    expect(u.anonymized_at).not.toBeNull();
    const p = (await ctx.pool.query('SELECT title, description FROM cards WHERE id = $1', [s.priv])).rows[0];
    expect(p.title).toBe('Tarefa privada removida');
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM checklist_items WHERE card_id = $1', [s.priv])).rows[0].n).toBe(0);
    const list = (await call('admin', 'GET', '/api/admin/users')).body.find((x: any) => x.id === id);
    expect(list.anonymized).toBe(true);
  });

  it('o log e os comentários continuam, com o autor "Usuário removido"', async () => {
    const r = await call('gest2', 'GET', `/api/cards/${s.child}`);
    expect(r.status).toBe(200);
    expect(r.body.comments.some((c: any) => c.body === 'Comecei hoje' && JSON.stringify(c).includes('Usuário removido'))).toBe(true);
    // Quem já tinha a tarefa comum (o sucessor) continua com ela.
    expect((await call('func2', 'GET', `/api/cards/${s.own}`)).status).toBe(200);
  });
});
