/**
 * Item 119 (F6 da revisão geral): avisos no aparelho (Web Push). Ligado só com as chaves VAPID no servidor;
 * cada pessoa liga e desliga os próprios aparelhos; os avisos novos vão para os aparelhos de quem os recebe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, type Ctx } from './helpers.js';
import { config } from '../src/config.js';
import { runPush, type PushSub } from '../src/services/push.js';
import { tx } from '../src/lib/db.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;
const sub = (n: number) => ({ endpoint: `https://push.exemplo.com/aparelho-${n}`, keys: { p256dh: 'B'.repeat(40), auth: 'a'.repeat(16) } });

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
});
afterAll(async () => {
  config.push.publicKey = null;
  config.push.privateKey = null;
  await ctx.app.close();
  await ctx.pool.end();
});

describe('avisos no aparelho (item 119)', () => {
  it('sem as chaves no servidor, fica desligado', async () => {
    expect((await call('func', 'GET', '/api/push')).body.publicKey).toBeNull();
    expect((await call('func', 'POST', '/api/push/subscribe', sub(1))).status).toBe(422);
  });

  it('liga, entrega os avisos novos só para os aparelhos de quem recebe, e desliga', async () => {
    config.push.publicKey = 'chave-publica-de-teste';
    config.push.privateKey = 'chave-privada-de-teste';
    expect((await call('func', 'GET', '/api/push')).body.publicKey).toBe('chave-publica-de-teste');
    expect((await call('func', 'POST', '/api/push/subscribe', sub(1))).body.devices).toBe(1);
    expect((await call('func2', 'POST', '/api/push/subscribe', sub(2))).status).toBe(200);
    // Avisos antigos não são reenviados.
    await tx(ctx.pool, (db) => runPush(db, async () => {}));

    const t = await newTask(ctx, 'gest', 'Planilha de custos');
    await delegateTask(ctx, 'gest', t.id, 'func');
    const got: { sub: PushSub; payload: any }[] = [];
    const r = await tx(ctx.pool, (db) => runPush(db, async (s, p) => { got.push({ sub: s, payload: JSON.parse(p) }); }));
    expect(r.sent).toBeGreaterThan(0);
    expect(got.every((g) => g.sub.endpoint === sub(1).endpoint)).toBe(true);
    expect(got[0].payload.url).toMatch(/^\/#\/tarefa\//);
    // Não repete.
    expect((await tx(ctx.pool, (db) => runPush(db, async () => {}))).sent).toBe(0);

    // Desligar só tira o aparelho da própria pessoa.
    await call('func2', 'POST', '/api/push/unsubscribe', { endpoint: sub(1).endpoint });
    expect((await call('func', 'GET', '/api/push')).body.devices).toBe(1);
    await call('func', 'POST', '/api/push/unsubscribe', { endpoint: sub(1).endpoint });
    expect((await call('func', 'GET', '/api/push')).body.devices).toBe(0);
  });

  it('aparelho que o navegador diz não existir mais sai da lista', async () => {
    const t = await newTask(ctx, 'gest', 'Relatório');
    await delegateTask(ctx, 'gest', t.id, 'func2');
    await tx(ctx.pool, (db) => runPush(db, async () => { throw Object.assign(new Error('gone'), { statusCode: 410 }); }));
    expect((await call('func2', 'GET', '/api/push')).body.devices).toBe(0);
  });
});
