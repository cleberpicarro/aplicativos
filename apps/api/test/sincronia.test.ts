/**
 * Item 122: delegações sempre em sincronia. Ciclo completo delegar → repassar → concluir → ciente, os avisos que deixam
 * de valer, o bloqueio de devolver/concluir com tarefa repassada em aberto, o cancelamento em cascata (com Desfazer)
 * e a conferência diária para a administração.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, type Ctx } from './helpers.js';
import { runHealthReport, syncCheck } from '../src/services/health.js';
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
const notes = async (who: string) => (await call(who, 'GET', '/api/notifications')).body as any[];
const counts = async (who: string) => (await call(who, 'GET', '/api/me')).body.counts;
const issues = async () => (await syncCheck(ctx.pool)).syncIssues;

/** dir delega a gest, gest aceita e repassa a func, que aceita. */
async function chain(title: string) {
  const p = await newTask(ctx, 'dir', title);
  const d1 = await delegateTask(ctx, 'dir', p.id, 'gest');
  await acceptTask(ctx, 'gest', d1.cardId);
  const d2 = await delegateTask(ctx, 'gest', d1.cardId, 'func');
  await acceptTask(ctx, 'func', d2.cardId);
  return { p, d1, d2 };
}

describe('ciclo completo (item 122)', () => {
  it('delegar, repassar, concluir de baixo para cima e dar ciente deixa tudo em sincronia', async () => {
    const { p, d1, d2 } = await chain('Ciclo completo');
    expect((await call('func', 'POST', `/api/cards/${d2.cardId}/complete`)).status).toBe(200);
    expect((await counts('gest')).needAction).toBe(1);
    expect((await call('gest', 'POST', `/api/delegations/${d2.delegationId}/ack`)).status).toBe(200);
    expect((await counts('gest')).needAction).toBe(0);
    expect((await call('gest', 'POST', `/api/cards/${d1.cardId}/complete`)).status).toBe(200);
    expect((await call('dir', 'POST', `/api/delegations/${d1.delegationId}/ack`)).status).toBe(200);
    expect((await card('dir', p.id)).card.child.status).toBe('ACKED');
    // os avisos de "aguardando ciente" foram resolvidos pelo ciente
    expect((await notes('gest')).filter((n) => n.type === 'completed' && !n.read_at)).toHaveLength(0);
    expect((await notes('dir')).filter((n) => n.type === 'completed' && !n.read_at)).toHaveLength(0);
    expect(await issues()).toBe(0);
  });
});

describe('avisos que deixam de valer (item 122)', () => {
  it('desfazer a conclusão avisa quem delegou e tira o "aguardando seu ciente" antigo', async () => {
    const p = await newTask(ctx, 'dir', 'Concluir e desfazer');
    const d = await delegateTask(ctx, 'dir', p.id, 'gest');
    await acceptTask(ctx, 'gest', d.cardId);
    await call('gest', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await notes('dir')).find((n) => n.type === 'completed' && n.card_id === d.cardId).read_at).toBeNull();
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/uncomplete`)).status).toBe(200);
    const mine = (await notes('dir')).filter((n) => n.card_id === d.cardId);
    expect(mine.find((n) => n.type === 'completed').read_at).not.toBeNull();
    const undone = mine.find((n) => n.type === 'completion_undone');
    expect(undone.read_at).toBeNull();
    expect(undone.text).toBe('Gest desfez a conclusão: a tarefa voltou para andamento');
    expect((await card('dir', p.id)).card.child.status).toBe('IN_PROGRESS');
    const mail = (await ctx.pool.query(`SELECT subject FROM email_outbox WHERE subject LIKE '%desfez a conclusão%'`)).rows;
    expect(mail.length).toBeGreaterThan(0);
  });

  it('redelegar uma devolvida tira o aviso "devolveu" de quem delegou', async () => {
    const p = await newTask(ctx, 'dir', 'Devolver e redelegar');
    const d = await delegateTask(ctx, 'dir', p.id, 'gest');
    await call('gest', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Sem tempo' });
    expect((await notes('dir')).find((n) => n.type === 'declined' && n.card_id === d.cardId).read_at).toBeNull();
    expect((await call('dir', 'POST', `/api/delegations/${d.delegationId}/redelegate`, { toUserId: ctx.users.gest2.id })).status).toBe(200);
    expect((await notes('dir')).find((n) => n.type === 'declined' && n.card_id === d.cardId).read_at).not.toBeNull();
  });

  it('reabrir resolve o "aguardando seu ciente"', async () => {
    const p = await newTask(ctx, 'dir', 'Reabrir');
    const d = await delegateTask(ctx, 'dir', p.id, 'gest');
    await acceptTask(ctx, 'gest', d.cardId);
    await call('gest', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('dir', 'POST', `/api/delegations/${d.delegationId}/reopen`, { comment: 'Falta o anexo' });
    expect((await notes('dir')).find((n) => n.type === 'completed' && n.card_id === d.cardId).read_at).not.toBeNull();
  });
});

describe('tarefa repassada para baixo (item 122)', () => {
  it('não dá para devolver nem concluir enquanto a delegação para baixo está em aberto', async () => {
    const { d1, d2 } = await chain('Bloqueios');
    const dec = await call('gest', 'POST', `/api/cards/${d1.cardId}/decline`, { reason: 'Não é comigo' });
    expect(dec.status).toBe(409);
    expect(dec.body.error).toContain('Você delegou esta tarefa para Func Teste');
    const done = await call('gest', 'POST', `/api/cards/${d1.cardId}/complete`);
    expect(done.status).toBe(409);
    expect(done.body.error).toContain('antes de concluir');
    // aguardando ciente também conta: primeiro o ciente, depois conclui
    await call('func', 'POST', `/api/cards/${d2.cardId}/complete`);
    expect((await call('gest', 'POST', `/api/cards/${d1.cardId}/complete`)).status).toBe(409);
    await call('gest', 'POST', `/api/delegations/${d2.delegationId}/ack`);
    expect((await call('gest', 'POST', `/api/cards/${d1.cardId}/complete`)).status).toBe(200);
  });

  it('cancelar leva junto a delegação repassada para baixo; o Desfazer traz as duas de volta', async () => {
    const { d1, d2 } = await chain('Cancelar em cascata');
    expect((await call('dir', 'POST', `/api/delegations/${d1.delegationId}/cancel`)).status).toBe(200);
    expect((await card('gest', d2.cardId)).card.delegation.status).toBe('CANCELED');
    expect((await card('gest', d2.cardId)).card.archivedAt).not.toBeNull();
    const note = (await notes('func')).find((n) => n.card_id === d2.cardId && n.type === 'canceled');
    expect(note.text).toBe('Dir cancelou a tarefa de origem: você não precisa mais fazer esta tarefa');
    expect((await counts('gest')).needAction).toBe(0);
    expect(await issues()).toBe(0);
    // quem estava no meio não desfaz sozinho o que foi cancelado de cima
    expect((await call('gest', 'POST', `/api/delegations/${d2.delegationId}/undo-cancel`)).status).toBe(409);

    expect((await call('dir', 'POST', `/api/delegations/${d1.delegationId}/undo-cancel`)).status).toBe(200);
    const back = (await card('func', d2.cardId)).card;
    expect(back).toMatchObject({ archivedAt: null });
    expect(back.delegation.status).toBe('IN_PROGRESS');
    expect(back.listId).not.toBeNull();
    expect((await card('gest', d1.cardId)).card.child.status).toBe('IN_PROGRESS');
    expect(await issues()).toBe(0);
  });

  it('retomar uma delegação em aberto também encerra a repassada para baixo', async () => {
    const { d1, d2 } = await chain('Retomar em cascata');
    expect((await call('dir', 'POST', `/api/delegations/${d1.delegationId}/resume`)).status).toBe(200);
    expect((await card('gest', d2.cardId)).card.delegation.status).toBe('CANCELED');
    expect((await call('func', 'GET', `/api/cards/${d2.cardId}`)).status).toBe(404);
    expect(await issues()).toBe(0);
  });
});

describe('conferência diária (item 122)', () => {
  it('acha delegação fora de sincronia, mostra em Configurações e manda no aviso diário; netas antigas ficam de fora', async () => {
    expect(await issues()).toBe(0);
    const { d1, d2 } = await chain('Neta perdida');
    // simula o defeito antigo: a delegação do meio cancelada sem levar a neta junto
    await ctx.pool.query(`UPDATE delegations SET status = 'CANCELED', canceled_at = now() WHERE id = $1`, [d1.delegationId]);
    await ctx.pool.query(`UPDATE cards SET archived_at = now(), list_id = NULL WHERE id = $1`, [d1.cardId]);
    expect(await issues()).toBe(1);
    const h = (await call('admin', 'GET', '/api/admin/health')).body;
    expect(h.syncIssues).toBe(1);
    expect(h.syncSamples[0].kind).toBe('neta');
    expect(h.syncSamples[0].text).toContain('Func Teste está com ela (em andamento), delegada por Gest Teste');

    await ctx.pool.query(`UPDATE app_settings SET problems_reported_at = now(), health_report_on = NULL`);
    await ctx.pool.query(`DELETE FROM email_outbox`);
    expect(await tx(ctx.pool, (db) => runHealthReport(db, new Date(Date.now() + 86400_000)))).toBeGreaterThan(0);
    const mail = (await ctx.pool.query(`SELECT body FROM email_outbox WHERE subject = 'SyncTasks: aviso de problemas'`)).rows[0];
    expect(mail.body).toContain('1 delegação(ões) fora de sincronia');

    // neta de antes da correção (decisão do Cleber: seguem como estão) não entra na conferência
    await ctx.pool.query(`UPDATE delegations SET created_at = '2026-11-03T12:00:00Z' WHERE id = $1`, [d2.delegationId]);
    expect(await issues()).toBe(0);
  });

  it('acha estado de delegação que não bate com a tarefa', async () => {
    const p = await newTask(ctx, 'dir', 'Estado errado');
    const d = await delegateTask(ctx, 'dir', p.id, 'gest');
    await acceptTask(ctx, 'gest', d.cardId);
    await ctx.pool.query(`UPDATE cards SET list_id = NULL WHERE id = $1`, [d.cardId]);
    const s = await syncCheck(ctx.pool);
    expect(s.syncSamples.some((x) => x.kind === 'estado' && x.text.includes('Estado errado'))).toBe(true);
    expect((await call('gest', 'GET', '/api/admin/health')).status).toBe(403);
  });
});
