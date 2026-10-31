/**
 * Item 46 (e-mails de aceite, prazo e resumo diário), item 47 (filtro da tabela também no quadro, com os
 * atalhos "Delegadas para mim" e "Delegadas por mim") e item 48 (desfazer o cancelamento de uma delegação).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, type Ctx } from './helpers.js';
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

/** Segunda-feira, 07/01/2030, às 7h30 em Brasília (10h30 em UTC). */
const MONDAY = new Date('2030-01-07T10:30:00Z');
const at = (iso: string) => new Date(iso);
const remind = (when: Date) => tx(ctx.pool, (db) => runReminders(db, when));

async function mails(to: string, like = '%') {
  const r = await ctx.pool.query(`SELECT subject, body FROM email_outbox WHERE to_email = $1 AND subject LIKE $2 ORDER BY created_at`, [to, like]);
  return r.rows as { subject: string; body: string }[];
}
const email = (who: string) => ctx.users[who].email;

describe('e-mails de aceite, prazo e resumo diário (item 46)', () => {
  it('quem delegou recebe aviso e e-mail quando a tarefa é aceita', async () => {
    const t = await newTask(ctx, 'gest', 'Aceite avisado');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const n = (await call('gest', 'GET', '/api/notifications')).body;
    expect(JSON.stringify(n)).toContain('Func aceitou a tarefa');
    const m = await mails(email('gest'), '%aceitou a tarefa%');
    expect(m).toHaveLength(1);
    expect(m[0].subject).toMatch(/^\[#\d+\] Func aceitou a tarefa$/);
  });

  it('véspera e vencido: um e-mail de cada, para o dono; na delegada, quem delegou recebe o de vencido; nada se repete', async () => {
    const eve = await newTask(ctx, 'gest2', 'Vence amanhã', '2030-01-08');
    await newTask(ctx, 'gest2', 'Venceu ontem', '2030-01-06');
    await newTask(ctx, 'gest2', 'Venceu há dias', '2030-01-02'); // atrasada antiga: não manda o "vencido" de novo nem em massa
    const done = await newTask(ctx, 'gest2', 'Concluída vence amanhã', '2030-01-08');
    await call('gest2', 'POST', `/api/cards/${done.id}/complete`);
    const priv = await newTask(ctx, 'gest2', 'Privada vence amanhã', '2030-01-08');
    await call('gest2', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
    const parent = await newTask(ctx, 'gest2', 'Delegada venceu ontem', '2030-01-06');
    const d = await delegateTask(ctx, 'gest2', parent.id, 'func3');
    await acceptTask(ctx, 'func3', d.cardId);

    await remind(MONDAY);
    const g = (await mails(email('gest2'), '%Prazo%')).map((x) => x.subject.replace(/^\[#\d+\] /, ''));
    expect(g.sort()).toEqual([
      'Prazo amanhã: Privada vence amanhã',
      'Prazo amanhã: Vence amanhã',
      'Prazo vencido: Delegada venceu ontem (com Func3)',
      'Prazo vencido: Venceu ontem',
    ]);
    const f = (await mails(email('func3'), '%Prazo%')).map((x) => x.subject.replace(/^\[#\d+\] /, ''));
    expect(f).toEqual(['Prazo vencido: Delegada venceu ontem']);
    // O de quem delegou leva o número e o link da tarefa de origem, a dele.
    const forDelegator = (await mails(email('gest2'), '%(com Func3)'))[0];
    expect(forDelegator.subject.startsWith(`[#${parent.num}]`)).toBe(true);
    expect(forDelegator.body).toContain(`/#/tarefa/${parent.id}`);

    // Rodar de novo no mesmo dia (ou mais tarde) não repete nada.
    await remind(MONDAY);
    await remind(at('2030-01-07T20:00:00Z'));
    expect(await mails(email('gest2'), '%Prazo%')).toHaveLength(4);
    expect(await mails(email('func3'), '%Prazo%')).toHaveLength(1);

    // Prazo mudou: avisa de novo, para a nova data.
    await call('gest2', 'PATCH', `/api/cards/${eve.id}`, { dueDate: '2030-01-09' });
    await remind(at('2030-01-08T12:00:00Z'));
    expect(await mails(email('gest2'), '%Prazo amanhã: Vence amanhã')).toHaveLength(2);
  });

  it('quem desliga os avisos de prazo em Meus dados não recebe; a escolha aparece em /api/me', async () => {
    expect((await call('gest3', 'GET', '/api/me')).body.prefs).toMatchObject({ emailDigest: true, emailDue: true });
    expect((await call('gest3', 'PATCH', '/api/me/prefs', { emailDue: false })).status).toBe(200);
    expect((await call('gest3', 'GET', '/api/me')).body.prefs).toMatchObject({ emailDigest: true, emailDue: false });
    await newTask(ctx, 'gest3', 'Sem aviso de prazo', '2030-02-05');
    await remind(at('2030-02-04T12:00:00Z'));
    expect(await mails(email('gest3'), '%Prazo%')).toHaveLength(0);
    await call('gest3', 'PATCH', '/api/me/prefs', { emailDue: true });
  });

  it('resumo diário: às 7h de dia útil, uma vez por dia, só para quem tem algo e quer receber', async () => {
    // Em 2030-03-04 (segunda): dir tem uma que vence hoje, uma atrasada e uma concluída aguardando o ciente dele.
    await newTask(ctx, 'dir', 'Vence hoje do diretor', '2030-03-04');
    await newTask(ctx, 'dir', 'Atrasada do diretor', '2030-02-20');
    const p = await newTask(ctx, 'dir', 'Para o ciente do diretor');
    const d = await delegateTask(ctx, 'dir', p.id, 'gest');
    await acceptTask(ctx, 'gest', d.cardId);
    await call('gest', 'POST', `/api/cards/${d.cardId}/complete`);
    // dir2 delega para gest3, que fica com a tarefa para aceitar; gest3 desliga o resumo.
    const q = await newTask(ctx, 'dir2', 'Para aceitar');
    await delegateTask(ctx, 'dir2', q.id, 'gest3');
    await call('gest3', 'PATCH', '/api/me/prefs', { emailDigest: false });

    await remind(at('2030-03-04T09:00:00Z')); // 6h em Brasília: cedo demais
    expect(await mails(email('dir'), 'Resumo do dia%')).toHaveLength(0);
    await remind(at('2030-03-04T10:15:00Z')); // 7h15
    const r = await mails(email('dir'), 'Resumo do dia%');
    expect(r).toHaveLength(1);
    expect(r[0].subject).toBe('Resumo do dia: 1 vence hoje, 1 atrasada, 1 aguarda seu ciente');
    expect(r[0].body).toContain('Vence hoje do diretor');
    expect(r[0].body).toContain('Atrasada do diretor');
    expect(r[0].body).toContain('Para o ciente do diretor');
    expect(r[0].body).toContain(`#${p.num} Para o ciente do diretor`);
    await remind(at('2030-03-04T11:15:00Z'));
    expect(await mails(email('dir'), 'Resumo do dia%')).toHaveLength(1);
    expect(await mails(email('gest3'), 'Resumo do dia%')).toHaveLength(0);
    // Quem não tem nada não recebe; sábado e domingo não há resumo.
    expect(await mails(email('func2'), 'Resumo do dia%')).toHaveLength(0);
    await remind(at('2030-03-09T10:15:00Z'));
    expect(await mails(email('dir'), 'Resumo do dia%')).toHaveLength(1);
    // Terça: sai de novo.
    await remind(at('2030-03-05T10:15:00Z'));
    expect(await mails(email('dir'), 'Resumo do dia%')).toHaveLength(2);
    // Administrador fora da hierarquia e pessoa desativada não recebem.
    expect(await mails(email('admin'), 'Resumo do dia%')).toHaveLength(0);
  });

  it('o resumo não mostra tarefa de outra pessoa nem a privada de ninguém além do dono', async () => {
    const priv = await newTask(ctx, 'func2', 'Segredo com prazo', '2030-04-01');
    await call('func2', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
    await remind(at('2030-04-01T10:15:00Z'));
    const r = await ctx.pool.query(`SELECT to_email FROM email_outbox WHERE body LIKE '%Segredo com prazo%'`);
    expect(r.rows.map((x) => x.to_email)).toEqual([email('func2')]);
  });
});

describe('filtro no quadro e atalhos de delegadas (item 47)', () => {
  const match = (who: string, boardId: string, filter: object) =>
    call(who, 'GET', `/api/boards/${boardId}/match?filter=${encodeURIComponent(JSON.stringify(filter))}`);

  it('devolve as tarefas do quadro que atendem ao filtro, com os atalhos para mim e por mim', async () => {
    const open = await newTask(ctx, 'dir2', 'Aberta comum');
    const done = await newTask(ctx, 'dir2', 'Concluída comum');
    await call('dir2', 'POST', `/api/cards/${done.id}/complete`);
    const byMe = await newTask(ctx, 'dir2', 'Delegada pelo diretor');
    await delegateTask(ctx, 'dir2', byMe.id, 'gest3');
    const p = await newTask(ctx, 'ceo', 'Do CEO para o diretor');
    const toMe = await delegateTask(ctx, 'ceo', p.id, 'dir2');
    await acceptTask(ctx, 'dir2', toMe.cardId);
    const board = (await call('dir2', 'GET', '/api/boards')).body[0].id;
    const all = [open.id, done.id, byMe.id, toMe.cardId];
    expect((await call('dir2', 'GET', `/api/boards/${board}`)).body.cards.map((c: any) => c.id)).toEqual(expect.arrayContaining(all));
    // Só as tarefas deste teste (o quadro tem outras, de testes anteriores).
    const ids = async (f: object) => {
      const r = await match('dir2', board, f);
      expect(r.status).toBe(200);
      return r.body.ids.filter((x: string) => all.includes(x)).sort();
    };

    expect(await ids({ all: [{ field: 'status', op: 'eq', value: 'open' }] })).toEqual(all.filter((x: string) => x !== done.id).sort());
    expect(await ids({ quick: { byMe: true } })).toEqual([byMe.id]);
    expect(await ids({ quick: { toMe: true } })).toEqual([toMe.cardId]);
    expect(await ids({ quick: { toMe: true, byMe: true } })).toEqual([byMe.id, toMe.cardId].sort());
    expect(await ids({ all: [{ field: 'title', op: 'contains', value: 'CEO' }], quick: { byMe: true } })).toEqual([]);
    // "Quadro" e "Arquivada" não valem dentro do quadro: são ignoradas, com aviso.
    const r = await match('dir2', board, { all: [{ field: 'archived', op: 'eq', value: true }, { field: 'title', op: 'contains', value: 'comum' }] });
    expect(r.body.ignored).toBe(true);
    expect(r.body.ids.filter((x: string) => all.includes(x)).sort()).toEqual([open.id, done.id].sort());
    // O atalho também vale na tabela (um filtro só para as duas visões).
    const t = await call('dir2', 'GET', `/api/table?filter=${encodeURIComponent(JSON.stringify({ quick: { byMe: true } }))}`);
    expect(t.body.rows.map((x: any) => x.id).filter((x: string) => all.includes(x))).toEqual([byMe.id]);
  });

  it('delegada por mim sai do atalho depois do ciente', async () => {
    const p = await newTask(ctx, 'gest2', 'Delegada até o ciente');
    const d = await delegateTask(ctx, 'gest2', p.id, 'func3');
    await acceptTask(ctx, 'func3', d.cardId);
    const board = (await call('gest2', 'GET', '/api/boards')).body[0].id;
    expect((await match('gest2', board, { quick: { byMe: true } })).body.ids).toContain(p.id);
    await call('func3', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await match('gest2', board, { quick: { byMe: true } })).body.ids).toContain(p.id);
    await call('gest2', 'POST', `/api/delegations/${d.delegationId}/ack`);
    expect((await match('gest2', board, { quick: { byMe: true } })).body.ids).not.toContain(p.id);
  });

  it('ninguém consulta o quadro de outra pessoa, nem com filtro', async () => {
    const board = (await call('gest', 'GET', '/api/boards')).body[0].id;
    for (const who of ['admin', 'ceo', 'dir', 'gest2', 'func']) {
      expect((await match(who, board, {})).status, who).toBe(404);
    }
    expect((await call('gest', 'GET', `/api/boards/${board}/match?filter=nao-e-json`)).status).toBe(422);
  });
});

describe('desfazer o cancelamento da delegação (item 48)', () => {
  it('a tarefa volta ao mesmo quadro, fase e número da pessoa, com o que ela escreveu, e ela é avisada', async () => {
    const p = await newTask(ctx, 'gest', 'Cancelar e desfazer');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'Já comecei' });
    const before = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body.card;

    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`)).status).toBe(200);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).status).toBe(404);
    expect((await call('gest', 'GET', `/api/cards/${p.id}`)).body.card.child).toBeNull();

    // Só quem delegou desfaz.
    for (const who of ['func', 'dir', 'gest2', 'admin']) {
      expect((await call(who, 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status, who).toBe(404);
    }
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status).toBe(200);
    const after = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body;
    expect(after.card).toMatchObject({ listId: before.listId, num: before.num, position: before.position, archivedAt: null });
    expect(after.card.delegation.status).toBe('IN_PROGRESS');
    expect(after.comments.map((c: any) => c.body)).toContain('Já comecei');
    expect((await call('gest', 'GET', `/api/cards/${p.id}`)).body.card.child).toMatchObject({ cardId: d.cardId, status: 'IN_PROGRESS' });
    expect(JSON.stringify((await call('func', 'GET', '/api/notifications')).body)).toContain('desfez o cancelamento');
    const log = (await call('dir', 'GET', `/api/cards/${d.cardId}/events`)).body.map((e: any) => e.type);
    expect(log).toContain('cancel_undone');
    // Não dá para desfazer duas vezes.
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status).toBe(409);
  });

  it('a que estava aguardando aceite volta à caixa de entrada com o mesmo número', async () => {
    const p = await newTask(ctx, 'gest', 'Na caixa, cancelar');
    const d = await delegateTask(ctx, 'gest', p.id, 'func2');
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status).toBe(200);
    const c = (await call('func2', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(c).toMatchObject({ inInbox: true, num: d.num });
    expect(c.delegation.status).toBe('PENDING_ACCEPT');
  });

  it('não desfaz depois do tempo, nem quando a tarefa de origem já foi delegada de novo', async () => {
    const p = await newTask(ctx, 'gest', 'Tarde demais');
    const d = await delegateTask(ctx, 'gest', p.id, 'func');
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    await ctx.pool.query(`UPDATE delegations SET canceled_at = now() - interval '11 minutes' WHERE id = $1`, [d.delegationId]);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/undo-cancel`)).status).toBe(409);

    const p2 = await newTask(ctx, 'gest', 'Delegada de novo');
    const d2 = await delegateTask(ctx, 'gest', p2.id, 'func');
    await call('gest', 'POST', `/api/delegations/${d2.delegationId}/cancel`);
    await delegateTask(ctx, 'gest', p2.id, 'func2');
    expect((await call('gest', 'POST', `/api/delegations/${d2.delegationId}/undo-cancel`)).status).toBe(409);
    // Delegação que não foi cancelada também não.
    const p3 = await newTask(ctx, 'gest', 'Nunca cancelada');
    const d3 = await delegateTask(ctx, 'gest', p3.id, 'func');
    expect((await call('gest', 'POST', `/api/delegations/${d3.delegationId}/undo-cancel`)).status).toBe(409);
  });
});
