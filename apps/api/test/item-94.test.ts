/**
 * Item 94: o administrador liga e desliga o destaque em cor sólida das tarefas atrasadas e das que vencem hoje,
 * e escolhe a cor de cada um. Vale para todas as pessoas (chega em /api/me).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, type Ctx } from './helpers.js';

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

describe('destaque das atrasadas e de hoje (item 94)', () => {
  it('nasce desligado, com vermelho e amarelo como cores sugeridas', async () => {
    expect((await call('admin', 'GET', '/api/admin/settings')).body).toEqual({ lateOn: false, lateColor: 'vermelho', todayOn: false, todayColor: 'amarelo' });
    expect((await call('func', 'GET', '/api/me')).body.highlight).toEqual({ late: null, today: null });
  });

  it('o administrador liga e escolhe a cor; todas as pessoas recebem', async () => {
    const r = await call('admin', 'PATCH', '/api/admin/settings', { lateOn: true, todayOn: true, todayColor: 'verde' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ lateOn: true, lateColor: 'vermelho', todayOn: true, todayColor: 'verde' });
    for (const who of ['ceo', 'gest', 'func']) expect((await call(who, 'GET', '/api/me')).body.highlight).toEqual({ late: 'vermelho', today: 'verde' });
    await call('admin', 'PATCH', '/api/admin/settings', { lateColor: 'grafite', todayOn: false });
    expect((await call('func', 'GET', '/api/me')).body.highlight).toEqual({ late: 'grafite', today: null });
  });

  it('desligar guarda a cor escolhida para quando ligar de novo', async () => {
    await call('admin', 'PATCH', '/api/admin/settings', { lateOn: false });
    expect((await call('func', 'GET', '/api/me')).body.highlight.late).toBeNull();
    await call('admin', 'PATCH', '/api/admin/settings', { lateOn: true });
    expect((await call('func', 'GET', '/api/me')).body.highlight.late).toBe('grafite');
  });

  it('cor fora da lista é recusada; quem não é administrador recebe 403', async () => {
    expect((await call('admin', 'PATCH', '/api/admin/settings', { lateColor: 'amarelo' })).status).toBe(422);
    expect((await call('admin', 'PATCH', '/api/admin/settings', { todayColor: '#ff0000' })).status).toBe(422);
    expect((await call('ceo', 'PATCH', '/api/admin/settings', { lateOn: false })).status).toBe(403);
    expect((await call('admin', 'GET', '/api/admin/settings')).body.lateOn).toBe(true);
  });
});
