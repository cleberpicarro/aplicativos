/**
 * Item 121: uso da plataforma (botão em Pessoas, só administração). Conta as ações do log por dia (ou mês) e por pessoa,
 * no dia de Brasília, sem os registros espelho da delegação.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, type Ctx } from './helpers.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;
let today = '';

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
  today = (await ctx.pool.query(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`)).rows[0].d;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

const shift = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

describe('uso da plataforma (item 121)', () => {
  it('conta as ações de cada pessoa no dia, uma vez cada', async () => {
    const t = await newTask(ctx, 'gest', 'Tarefa para contar');
    await call('gest', 'POST', `/api/cards/${t.id}/comments`, { body: 'Oi' });
    await delegateTask(ctx, 'gest', t.id, 'func');
    const r = await call('admin', 'GET', `/api/admin/usage?from=${shift(today, -2)}&to=${today}`);
    expect(r.status).toBe(200);
    expect(r.body.unit).toBe('day');
    expect(r.body.buckets).toEqual([shift(today, -2), shift(today, -1), today]);
    const gest = r.body.people.find((p: { id: string }) => p.id === ctx.users.gest.id);
    // Conta o que está no log da gest, sem o “delegou para baixo” (espelho na tarefa de origem).
    const { rows } = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM card_events WHERE actor_id = $1 AND type NOT IN ('delegated_down','child_resumed','child_canceled','child_cancel_undone')`, [ctx.users.gest.id]);
    expect(gest.total).toBe(rows[0].n);
    expect(gest.series[2]).toBe(rows[0].n);
    const mirror = (await ctx.pool.query(`SELECT count(*)::int AS n FROM card_events WHERE actor_id = $1 AND type = 'delegated_down'`, [ctx.users.gest.id])).rows[0].n;
    expect(mirror).toBeGreaterThan(0);
    expect(r.body.byType.find((g: { group: string }) => g.group === 'Comentar').n).toBeGreaterThanOrEqual(1);
    expect(r.body.total).toBe(r.body.people.reduce((a: number, p: { total: number }) => a + p.total, 0));
    expect(r.body.idle).toContain('Dir2 Teste');
  });

  it('ações fora do período não entram; o dia segue o horário de Brasília', async () => {
    const t = await newTask(ctx, 'func2', 'Antiga');
    // 1h da manhã (UTC) do dia 10/01 é ainda 09/01 em Brasília.
    // O log é só inserção: grava direto duas ações antigas da func2 nessa hora.
    await ctx.pool.query(`INSERT INTO card_events (card_id, actor_id, type, created_at) VALUES ($1, $2, 'moved', '2025-01-10 01:00:00+00'), ($1, $2, 'delegated_down', '2025-01-10 01:00:00+00')`, [t.id, ctx.users.func2.id]);
    const r9 = await call('admin', 'GET', '/api/admin/usage?from=2025-01-09&to=2025-01-09');
    expect(r9.body.people.map((p: { id: string }) => p.id)).toEqual([ctx.users.func2.id]);
    expect(r9.body.total).toBe(1);
    const r10 = await call('admin', 'GET', '/api/admin/usage?from=2025-01-10&to=2025-01-10');
    expect(r10.body.total).toBe(0);
  });

  it('período longo vira uma barra por mês', async () => {
    const r = await call('admin', 'GET', '/api/admin/usage?from=2024-12-15&to=2025-03-02');
    expect(r.body.unit).toBe('month');
    expect(r.body.buckets).toEqual(['2024-12-01', '2025-01-01', '2025-02-01', '2025-03-01']);
    expect(r.body.people[0].series[1]).toBeGreaterThan(0);
  });

  it('recusa período invertido ou maior que 3 anos', async () => {
    expect((await call('admin', 'GET', '/api/admin/usage?from=2025-02-01&to=2025-01-01')).status).toBe(422);
    expect((await call('admin', 'GET', '/api/admin/usage?from=2020-01-01&to=2025-01-01')).status).toBe(422);
    expect((await call('admin', 'GET', '/api/admin/usage?from=2025-02-30&to=2025-03-01')).status).toBe(422);
  });
});
