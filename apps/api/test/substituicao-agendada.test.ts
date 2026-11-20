/**
 * Item 76: a administração vê e mexe nas substituições de todos (quadro “Férias e ausências” em Pessoas)
 * e a substituição pode ficar agendada para o primeiro dia fora.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, day, type Ctx } from './helpers.js';
import { runScheduledStarts } from '../src/services/substitution.js';
import { tx } from '../src/lib/db.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;

async function como(who: string, as: string, url: string) {
  const r = await ctx.app.inject({
    method: 'GET',
    url,
    headers: { cookie: ctx.users[who].cookie, 'x-synctasks': '1', 'x-synctasks-como': ctx.users[as].id },
  });
  return r.statusCode;
}
const texts = async (who: string) => ((await call(who, 'GET', '/api/notifications')).body as any[]).map((n) => n.text as string);

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

describe('substituição agendada e quadro da administração (item 76)', () => {
  it('agendada: aparece como agendada, o seletor ainda não vale e o substituto já é avisado', async () => {
    const r = await call('gest', 'POST', '/api/substitution', { substituteId: ctx.users.func.id, shareCommon: false, startsOn: day(3), endsOn: day(10) });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('scheduled');
    expect(r.body.startsOn).toBe(day(3));
    expect(await como('func', 'gest', '/api/inbox')).toBe(403);
    expect((await call('func', 'GET', '/api/me')).body.substitution.covering).toHaveLength(0);
    expect((await texts('func')).some((t) => t.includes('a partir de'))).toBe(true);
    // Meus dados mostra a agendada.
    expect((await call('gest', 'GET', '/api/me')).body.substitution.mine.status).toBe('scheduled');
  });

  it('último dia antes do primeiro é recusado', async () => {
    const r = await call('gest2', 'POST', '/api/substitution', { substituteId: ctx.users.func2.id, shareCommon: false, startsOn: day(5), endsOn: day(2) });
    expect(r.status).toBe(422);
  });

  it('começa sozinha no dia: o seletor passa a valer e os dois recebem o aviso uma vez só', async () => {
    await ctx.pool.query(`UPDATE substitutions SET starts_on = $1 WHERE absent_id = $2 AND ended_at IS NULL`, [day(0), ctx.users.gest.id]);
    expect(await tx(ctx.pool, runScheduledStarts)).toBe(1);
    expect(await tx(ctx.pool, runScheduledStarts)).toBe(0);
    expect(await como('func', 'gest', '/api/inbox')).toBe(200);
    expect((await texts('func')).some((t) => t.startsWith('Começou hoje a sua substituição de'))).toBe(true);
    expect((await texts('gest')).some((t) => t.startsWith('Começou hoje a sua substituição por'))).toBe(true);
  });

  it('a lista da administração mostra em vigor, agendadas e histórico; outra pessoa não acessa', async () => {
    expect((await call('dir', 'GET', '/api/admin/substitutions')).status).toBe(403);
    // A administração agenda a do diretor e cancela antes de começar.
    const r = await call('admin', 'POST', '/api/substitution', { userId: ctx.users.dir.id, substituteId: ctx.users.gest2.id, shareCommon: true, startsOn: day(7) });
    expect(r.status).toBe(200);
    const list = (await call('admin', 'GET', '/api/admin/substitutions')).body;
    const byAbsent = (id: string) => list.open.find((s: any) => s.absent.id === id);
    expect(byAbsent(ctx.users.gest.id).status).toBe('active');
    expect(byAbsent(ctx.users.gest.id).bySelf).toBe(true);
    expect(byAbsent(ctx.users.dir.id).status).toBe('scheduled');
    expect(byAbsent(ctx.users.dir.id).bySelf).toBe(false);
    expect((await texts('dir')).some((t) => t.includes('escolheu') && t.includes('a partir de'))).toBe(true);

    expect((await call('admin', 'POST', '/api/substitution/end', { userId: ctx.users.dir.id })).status).toBe(200);
    expect((await texts('gest2')).some((t) => t.includes('foi cancelada'))).toBe(true);
    // A cancelada nunca começa, nem quando chega o dia.
    await ctx.pool.query(`UPDATE substitutions SET starts_on = $1 WHERE absent_id = $2`, [day(0), ctx.users.dir.id]);
    expect(await tx(ctx.pool, runScheduledStarts)).toBe(0);

    expect((await call('admin', 'POST', '/api/substitution/end', { userId: ctx.users.gest.id })).status).toBe(200);
    const after = (await call('admin', 'GET', '/api/admin/substitutions')).body;
    expect(after.open).toHaveLength(0);
    expect(after.history.map((s: any) => s.absent.id)).toEqual(expect.arrayContaining([ctx.users.gest.id, ctx.users.dir.id]));
    expect(after.history.every((s: any) => s.status === 'ended' && s.endedByName)).toBe(true);
  });
});
