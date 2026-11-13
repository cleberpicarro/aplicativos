/** Itens 79 a 81: quem criou e quem delegou por último, balão de tarefa que chegou e seguidores por e-mail. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, type Ctx } from './helpers.js';
import { runFollowerMail, QUIET_MINUTES } from '../src/services/followers.js';
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

const card = async (who: string, id: string) => (await call(who, 'GET', `/api/cards/${id}`)).body;
const later = (min: number) => new Date(Date.now() + min * 60_000);
const mail = (now: Date) => tx(ctx.pool, (db) => runFollowerMail(db, now));
const outbox = async (to: string) =>
  (await ctx.pool.query(`SELECT subject, body FROM email_outbox WHERE to_email = $1 ORDER BY created_at`, [to])).rows;

describe('quem criou e quem delegou por último (item 79)', () => {
  it('tarefa própria: criada pela própria pessoa, sem data de delegação', async () => {
    const t = await newTask(ctx, 'gest', 'Própria');
    const { origin } = await card('gest', t.id);
    expect(origin).toMatchObject({ creatorId: ctx.users.gest.id, creatorName: 'Gest Teste', delegatedAt: null });
    expect(origin.createdAt).toBeTruthy();
  });

  it('desdobramento: mostra quem criou a tarefa de origem (lá em cima) e a data da última delegação', async () => {
    const t = await newTask(ctx, 'dir', 'Vem do diretor');
    const d1 = await delegateTask(ctx, 'dir', t.id, 'gest');
    await acceptTask(ctx, 'gest', d1.cardId);
    const d2 = await delegateTask(ctx, 'gest', d1.cardId, 'func');
    const { card: c, origin } = await card('func', d2.cardId);
    expect(c.delegation.delegatorName).toBe('Gest Teste');
    expect(origin).toMatchObject({ creatorId: ctx.users.dir.id, creatorName: 'Dir Teste' });
    expect(origin.delegatedAt).toBeTruthy();
  });

  it('redelegada: a data é a da redelegação, e quem delegou é quem redelegou', async () => {
    const t = await newTask(ctx, 'gest', 'Para redelegar');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Não é comigo' });
    const first = (await card('gest', d.cardId)).origin.delegatedAt;
    await new Promise((r) => setTimeout(r, 20));
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/redelegate`, { toUserId: ctx.users.func2.id })).status).toBe(200);
    const { origin } = await card('func2', d.cardId);
    expect(origin.creatorName).toBe('Gest Teste');
    expect(new Date(origin.delegatedAt).getTime()).toBeGreaterThan(new Date(first).getTime());
  });
});

describe('balão de tarefa que chegou (item 80)', () => {
  it('delegada e transferida aparecem uma vez; depois de marcadas, não voltam', async () => {
    const t = await newTask(ctx, 'gest', 'Chegou agora');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    const fresh = (await call('func', 'GET', '/api/me')).body.fresh;
    const mine = fresh.find((n: any) => n.cardId === d.cardId);
    expect(mine.text).toContain('delegou: Chegou agora');
    expect((await call('func', 'POST', '/api/notifications/popped', { ids: fresh.map((n: any) => n.id) })).status).toBe(200);
    expect((await call('func', 'GET', '/api/me')).body.fresh).toEqual([]);
    // Continua no sino até ser lido.
    expect((await call('func', 'GET', '/api/me')).body.counts.unread).toBeGreaterThan(0);

    const own = await newTask(ctx, 'func', 'Vai para o colega');
    expect((await call('func', 'POST', `/api/cards/${own.id}/transfer`, { toUserId: ctx.users.func2.id })).status).toBe(200);
    const f2 = (await call('func2', 'GET', '/api/me')).body.fresh;
    expect(f2.some((n: any) => n.cardId === own.id && n.text.includes('transferiu'))).toBe(true);
  });

  it('clicar no balão marca o aviso como lido; ninguém marca os avisos de outra pessoa', async () => {
    const t = await newTask(ctx, 'gest', 'Clique para ver');
    await delegateTask(ctx, 'gest', t.id, 'func2');
    const [n] = (await call('func2', 'GET', '/api/me')).body.fresh.filter((x: any) => x.text.includes('Clique para ver'));
    expect((await call('func', 'POST', '/api/notifications/popped', { ids: [n.id], read: true })).status).toBe(200);
    const row = (await ctx.pool.query('SELECT popped_at, read_at FROM notifications WHERE id = $1', [n.id])).rows[0];
    expect(row).toEqual({ popped_at: null, read_at: null });
    expect((await call('func2', 'POST', '/api/notifications/popped', { ids: [n.id], read: true })).status).toBe(200);
    const after = (await ctx.pool.query('SELECT popped_at, read_at FROM notifications WHERE id = $1', [n.id])).rows[0];
    expect(after.popped_at).not.toBeNull();
    expect(after.read_at).not.toBeNull();
  });

  it('outros avisos (concluída, devolvida) não viram balão', async () => {
    const t = await newTask(ctx, 'gest', 'Só no sino');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('gest', 'POST', '/api/notifications/popped', { ids: (await call('gest', 'GET', '/api/me')).body.fresh.map((n: any) => n.id) });
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await call('gest', 'GET', '/api/me')).body.fresh).toEqual([]);
  });
});

describe('seguidores (item 81)', () => {
  it('só e-mails @nerus.com.br; repetido e tarefa privada são recusados; a auditoria não mexe', async () => {
    const t = await newTask(ctx, 'gest', 'Com seguidores');
    expect((await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: 'alguem@gmail.com' })).status).toBe(422);
    expect((await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: 'nao-e-email' })).status).toBe(422);
    const ok = await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: ' Ana.Souza@Nerus.com.br ' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([expect.objectContaining({ email: 'ana.souza@nerus.com.br', addedByName: 'Gest Teste' })]);
    expect((await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: 'ana.souza@nerus.com.br' })).status).toBe(409);
    expect((await card('gest', t.id)).followers).toHaveLength(1);
    expect((await call('dir', 'POST', `/api/cards/${t.id}/followers`, { email: 'x@nerus.com.br' })).status).toBe(403);
    expect((await call('gest2', 'POST', `/api/cards/${t.id}/followers`, { email: 'x@nerus.com.br' })).status).toBe(404);

    const priv = await newTask(ctx, 'gest', 'Privada');
    await call('gest', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
    expect((await call('gest', 'POST', `/api/cards/${priv.id}/followers`, { email: 'ana@nerus.com.br' })).status).toBe(409);

    expect((await call('gest', 'POST', `/api/cards/${t.id}/followers/remove`, { email: 'ana.souza@nerus.com.br' })).body).toEqual([]);
    const log = (await call('dir', 'GET', `/api/cards/${t.id}/events`)).body.map((e: any) => e.type);
    expect(log).toEqual(expect.arrayContaining(['follower_added', 'follower_removed']));
  });

  it('o e-mail sai depois de 5 minutos sem novidade, com o que mudou e o log completo, uma vez só', async () => {
    const t = await newTask(ctx, 'gest', 'Tarefa seguida');
    const to = 'seguidor1@nerus.com.br';
    await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: to });
    await call('gest', 'POST', `/api/cards/${t.id}/comments`, { body: 'Primeiro comentário' });
    await mail(later(1));
    expect(await outbox(to)).toHaveLength(0); // ainda dentro dos 5 minutos
    await mail(later(QUIET_MINUTES + 1));
    const [m] = await outbox(to);
    expect(m.subject).toContain('2 novidades');
    expect(m.body).toContain('Gest Teste incluiu um seguidor');
    expect(m.body).toContain('comentou: “Primeiro comentário”');
    expect(m.body).toContain('Log completo da tarefa:');
    expect(m.body).toContain('Gest Teste criou a tarefa');
    expect(m.body).toMatch(/\/seguir\/sair\?t=[0-9a-f-]{36}/);
    await mail(later(QUIET_MINUTES + 2));
    expect(await outbox(to)).toHaveLength(1);

    await call('gest', 'POST', `/api/cards/${t.id}/complete`);
    await mail(later(QUIET_MINUTES + 1));
    const all = await outbox(to);
    expect(all).toHaveLength(2);
    expect(all[1].subject).toContain('concluiu a tarefa');
  });

  it('ao delegar, os seguidores passam para o cartão de quem recebe, que também pode mudá-los', async () => {
    const t = await newTask(ctx, 'gest', 'Seguida e delegada');
    await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: 'seguidor2@nerus.com.br' });
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    expect((await card('func', d.cardId)).followers.map((f: any) => f.email)).toEqual(['seguidor2@nerus.com.br']);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/followers`, { email: 'outro@nerus.com.br' })).status).toBe(200);
    // Quem delegou também inclui no cartão de quem recebeu.
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/followers`, { email: 'mais@nerus.com.br' })).status).toBe(200);
  });

  it('tarefa que virou privada não manda nada, nem depois, sobre o período privado', async () => {
    const t = await newTask(ctx, 'gest', 'Vai ficar privada');
    const to = 'seguidor3@nerus.com.br';
    await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: to });
    await mail(later(QUIET_MINUTES + 1));
    expect(await outbox(to)).toHaveLength(1);
    await call('gest', 'PATCH', `/api/cards/${t.id}`, { isPrivate: true });
    await call('gest', 'POST', `/api/cards/${t.id}/comments`, { body: 'Assunto sigiloso' });
    await mail(later(QUIET_MINUTES + 1));
    expect(await outbox(to)).toHaveLength(1);
    await call('gest', 'PATCH', `/api/cards/${t.id}`, { isPrivate: false });
    await mail(later(QUIET_MINUTES + 1));
    const all = await outbox(to);
    expect(all).toHaveLength(2);
    expect(all[1].body.split('Log completo')[0]).not.toContain('sigiloso');
  });

  it('parar de seguir pelo link: abrir só mostra o botão; confirmar tira o seguidor e fica no log', async () => {
    const t = await newTask(ctx, 'gest', 'Sair pelo link');
    await call('gest', 'POST', `/api/cards/${t.id}/followers`, { email: 'sair@nerus.com.br' });
    const { token } = (await ctx.pool.query('SELECT token FROM card_followers WHERE card_id = $1', [t.id])).rows[0];
    const page = await ctx.app.inject({ method: 'GET', url: `/seguir/sair?t=${token}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Parar de seguir');
    expect((await card('gest', t.id)).followers).toHaveLength(1);
    const done = await ctx.app.inject({ method: 'POST', url: '/seguir/sair', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `t=${token}` });
    expect(done.statusCode).toBe(200);
    expect(done.body).toContain('sair@nerus.com.br');
    expect((await card('gest', t.id)).followers).toEqual([]);
    const again = await ctx.app.inject({ method: 'POST', url: '/seguir/sair', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: `t=${token}` });
    expect(again.body).toContain('já não segue');
    const bad = await ctx.app.inject({ method: 'GET', url: '/seguir/sair?t=inventado' });
    expect(bad.body).toContain('não é válido');
    const log = (await call('dir', 'GET', `/api/cards/${t.id}/events`)).body.find((e: any) => e.type === 'follower_removed');
    expect(log.after).toEqual({ self: true });
  });
});
