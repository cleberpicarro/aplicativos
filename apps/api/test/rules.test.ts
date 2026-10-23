/**
 * Frente 1 do plano de testes: regras de negócio que ainda não tinham teste próprio,
 * limites dos campos e segurança da conta. A referência de cada regra (RN-xx) está em docs/especificacao.md.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, firstListOf, day, login, PASSWORD, type Ctx } from './helpers.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;

beforeEach(async () => {
  ctx = await setup();
  call = api(ctx);
});
afterEach(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('quadros (RN-01, RN-05)', () => {
  it('pessoa nova recebe o quadro “Meu trabalho”; quadro novo vem com A fazer, Fazendo e Feito', async () => {
    const created = await call('admin', 'POST', '/api/admin/users', { name: 'Nova Pessoa', email: 'nova@teste.com', level: 3, managerId: ctx.users.gest.id });
    expect(created.status).toBe(200);
    const boards = await ctx.pool.query('SELECT id, name FROM boards WHERE owner_id = $1', [created.body.id]);
    expect(names(boards.rows)).toEqual(['Meu trabalho']);
    const lists = await ctx.pool.query('SELECT name FROM lists WHERE board_id = $1 ORDER BY position', [boards.rows[0].id]);
    expect(names(lists.rows)).toEqual(['A fazer', 'Fazendo', 'Feito']);

    const b = (await call('func', 'POST', '/api/boards', { name: '  Projetos  ' })).body;
    expect(b.name).toBe('Projetos');
    const detail = (await call('func', 'GET', `/api/boards/${b.id}`)).body;
    expect(names(detail.lists)).toEqual(['A fazer', 'Fazendo', 'Feito']);
    expect((await call('func', 'POST', '/api/boards', { name: '   ' })).status).toBe(422);
    expect((await call('admin', 'POST', '/api/boards', { name: 'Do admin' })).status).toBe(403);
  });

  it('fases: criar, renomear, reordenar; nome vazio é recusado (RN-02)', async () => {
    const boardId = (await call('func', 'GET', '/api/boards')).body[0].id;
    const l = (await call('func', 'POST', `/api/boards/${boardId}/lists`, { name: 'Revisão' })).body;
    expect((await call('func', 'PATCH', `/api/lists/${l.id}`, { name: 'Em revisão', position: 0.5 })).status).toBe(200);
    const detail = (await call('func', 'GET', `/api/boards/${boardId}`)).body;
    expect(names(detail.lists)).toEqual(['Em revisão', 'A fazer', 'Fazendo', 'Feito']);
    expect((await call('func', 'PATCH', `/api/lists/${l.id}`, { name: ' ' })).status).toBe(422);
    expect((await call('func', 'POST', `/api/boards/${boardId}/lists`, { name: '' })).status).toBe(422);
  });
});

describe('tarefa: campos e limites (RN-06)', () => {
  it('título obrigatório e com até 200 caracteres; descrição e datas validadas', async () => {
    const listId = await firstListOf(ctx, 'func');
    expect((await call('func', 'POST', '/api/cards', { listId, title: '   ' })).status).toBe(422);
    expect((await call('func', 'POST', '/api/cards', { listId, title: 'x'.repeat(201) })).status).toBe(422);
    const ok = await call('func', 'POST', '/api/cards', { listId, title: 'x'.repeat(200) });
    expect(ok.status).toBe(200);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { title: '' })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { description: 'd'.repeat(20001) })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { dueDate: '06/10/2026' })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { dueDate: '2026-02-30' })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { dueDate: '2026-13-01' })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { dueDate: day(1) })).status).toBe(200);
    expect((await call('func', 'PATCH', `/api/cards/${ok.body.id}`, { dueDate: null })).status).toBe(200);
  });

  it('identificadores malformados e rotas inexistentes não derrubam o servidor', async () => {
    expect((await call('func', 'GET', '/api/cards/nao-e-um-id')).status).toBe(422);
    expect((await call('func', 'GET', '/api/cards/by-code/ST-999999')).status).toBe(404);
    expect((await call('func', 'GET', '/api/cards/by-code/abc')).status).toBe(404);
    expect((await call('func', 'GET', '/api/nada')).status).toBe(404);
    expect((await call('func', 'POST', '/api/cards', 'texto solto')).status).toBeLessThan(500);
    expect((await call('func', 'POST', '/api/cards', { listId: '00000000-0000-0000-0000-000000000000', title: 'x' })).status).toBe(404);
  });

  it('busca com caracteres especiais (%, _, aspas) não quebra e não vira curinga', async () => {
    await newTask(ctx, 'func', 'Meta de 100% atingida');
    await newTask(ctx, 'func', 'Outra tarefa');
    for (const q of ['%', '_', "'", '"', '\\', '100%', "'; DROP TABLE cards; --", '<script>']) {
      const r = await call('func', 'GET', `/api/search?q=${encodeURIComponent(q)}`);
      expect(r.status, q).toBe(200);
    }
    const pct = (await call('func', 'GET', `/api/search?q=${encodeURIComponent('%')}`)).body.results;
    expect(pct.map((c: any) => c.title)).toEqual(['Meta de 100% atingida']);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM cards')).rows[0].n).toBeGreaterThan(0);
  });
});

describe('conclusão (RN-12, RN-13)', () => {
  it('tarefa própria: concluir e desfazer; não conclui duas vezes', async () => {
    const t = await newTask(ctx, 'func', 'Própria');
    expect((await call('func', 'POST', `/api/cards/${t.id}/complete`)).status).toBe(200);
    expect((await call('func', 'POST', `/api/cards/${t.id}/complete`)).status).toBe(409);
    expect((await call('func', 'POST', `/api/cards/${t.id}/uncomplete`)).status).toBe(200);
    expect((await call('func', 'POST', `/api/cards/${t.id}/uncomplete`)).status).toBe(409);
    expect((await call('func', 'GET', `/api/cards/${t.id}`)).body.card.completedAt).toBeNull();
  });

  it('delegada: desfazer a conclusão antes do ciente volta para “em andamento”; depois do ciente, não', async () => {
    const t = await newTask(ctx, 'gest', 'Delegada');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/uncomplete`)).status).toBe(200);
    let card = (await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(card.delegation.status).toBe('IN_PROGRESS');
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/uncomplete`)).status).toBe(409);
    card = (await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(card.delegation.status).toBe('ACKED');
    // depois do ciente o detentor ainda vê a tarefa (arquivada), mas não altera mais nada
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}`, { title: 'mudou' })).status).toBe(409);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'oi' })).status).toBe(409);
  });
});

describe('comentários (RN-10)', () => {
  it('detentor e delegador comentam; auditoria só lê; comentário não se edita nem apaga', async () => {
    const t = await newTask(ctx, 'gest', 'Com comentários');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'Começando' })).status).toBe(200);
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'Ok' })).status).toBe(200);
    expect((await call('dir', 'POST', `/api/cards/${d.cardId}/comments`, { body: 'Auditoria' })).status).toBe(403);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/comments`, { body: '   ' })).status).toBe(422);
    const cm = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body.comments;
    expect(cm.map((c: any) => c.body)).toEqual(['Começando', 'Ok']);
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}/comments/${cm[0].id}`, { body: 'x' })).status).toBe(404);
    expect((await call('func', 'DELETE', `/api/cards/${d.cardId}/comments/${cm[0].id}`)).status).toBe(404);
    // no banco, o log também não aceita alteração
    await expect(ctx.pool.query('DELETE FROM card_events WHERE card_id = $1', [d.cardId])).rejects.toThrow();
  });
});

describe('delegação: casos que faltavam (RN-16, RN-17, RN-20, RN-25, RN-26, RN-28)', () => {
  it('título e descrição são copiados; prazo sugerido vira o prazo; o delegador vê o novo prazo no log, com o anterior', async () => {
    const t = await newTask(ctx, 'gest', 'Planejar evento', day(10));
    await call('gest', 'PATCH', `/api/cards/${t.id}`, { description: 'Local e orçamento' });
    const d = await delegateTask(ctx, 'gest', t.id, 'func', { suggestedDue: day(7) });
    const child = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect([child.title, child.description, child.dueDate]).toEqual(['Planejar evento', 'Local e orçamento', day(7)]);
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'PATCH', `/api/cards/${d.cardId}`, { dueDate: day(9) });
    const log = (await call('dir', 'GET', `/api/cards/${d.cardId}/events`)).body;
    const due = log.find((e: any) => e.type === 'due_changed');
    expect([due.before.dueDate, due.after.dueDate]).toEqual([day(7), day(9)]);
  });

  it('não delega tarefa concluída, nem da caixa de entrada; delega de novo depois do ciente', async () => {
    const t = await newTask(ctx, 'gest', 'Reaproveitada');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    // na caixa de entrada do func: ainda não pode repassar
    const fromInbox = await call('func', 'POST', `/api/cards/${d.cardId}/delegate`, { toUserId: ctx.users.func2.id });
    expect(fromInbox.status).toBeGreaterThanOrEqual(400);
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`);
    const again = await delegateTask(ctx, 'gest', t.id, 'func2');
    expect(again.code).not.toBe(d.code);
    const done = await newTask(ctx, 'gest', 'Pronta');
    await call('gest', 'POST', `/api/cards/${done.id}/complete`);
    expect((await call('gest', 'POST', `/api/cards/${done.id}/delegate`, { toUserId: ctx.users.func.id })).status).toBe(409);
  });

  it('ciente e reabertura avisam o detentor; cancelar avisa e tira a tarefa dele', async () => {
    const t = await newTask(ctx, 'gest', 'Avisos');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/reopen`, { comment: 'Falta revisar' });
    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`);
    const types = (await call('func', 'GET', '/api/notifications')).body.map((n: any) => n.type);
    expect(types).toEqual(expect.arrayContaining(['delegated', 'reopened', 'acked']));
    // ciente de novo não pode
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`)).status).toBe(409);

    const t2 = await newTask(ctx, 'gest', 'Cancelada');
    const d2 = await delegateTask(ctx, 'gest', t2.id, 'func');
    await acceptTask(ctx, 'func', d2.cardId);
    await call('gest', 'POST', `/api/delegations/${d2.delegationId}/cancel`);
    expect((await call('func', 'GET', `/api/cards/${d2.cardId}`)).status).toBe(404);
    const board = (await call('func', 'GET', `/api/boards/${(await call('func', 'GET', '/api/boards')).body[0].id}`)).body;
    expect(board.cards.map((c: any) => c.id)).not.toContain(d2.cardId);
    expect((await call('func', 'GET', '/api/notifications')).body[0].type).toBe('canceled');
    // cancelar duas vezes ou depois do ciente não pode
    expect((await call('gest', 'POST', `/api/delegations/${d2.delegationId}/cancel`)).status).toBe(409);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`)).status).toBe(409);
  });

  it('tarefa com delegação para baixo em aberto não pode ser transferida nem arquivada', async () => {
    const t = await newTask(ctx, 'gest', 'Com filho');
    await delegateTask(ctx, 'gest', t.id, 'func');
    expect((await call('gest', 'POST', `/api/cards/${t.id}/transfer`, { toUserId: ctx.users.gest2.id })).status).toBe(409);
    await call('gest', 'POST', `/api/cards/${t.id}/complete`);
    expect((await call('gest', 'POST', `/api/cards/${t.id}/archive`)).status).toBe(409);
  });
});

describe('transferência: casos que faltavam (RN-24, RN-31, RN-32, RN-33)', () => {
  it('quem transfere deixa de ver; o código se mantém; transferida não pode ser devolvida', async () => {
    const t = await newTask(ctx, 'gest', 'Delegada e transferida');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const targets = (await call('func', 'GET', `/api/cards/${d.cardId}/transfer-targets`)).body;
    expect(targets.map((x: any) => x.id)).toEqual([ctx.users.func2.id]); // o delegador (gest) não aparece
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/transfer`, { toUserId: ctx.users.func2.id })).status).toBe(200);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).status).toBe(404); // RN-31
    const inbox = (await call('func2', 'GET', '/api/inbox')).body;
    expect(inbox.map((c: any) => c.code)).toEqual([d.code]); // RN-33
    expect((await call('func2', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Não é comigo' })).status).toBe(409); // RN-24
    // o delegador continua acompanhando e dá o ciente (RN-32)
    await acceptTask(ctx, 'func2', d.cardId);
    await call('func2', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`)).status).toBe(200);
  });
});

describe('pessoas desativadas (RN-42)', () => {
  it('não entram, perdem a sessão e não aparecem como destino', async () => {
    const t = await newTask(ctx, 'gest', 'Para alguém');
    expect((await call('admin', 'POST', `/api/admin/users/${ctx.users.func2.id}/active`, { active: false })).status).toBe(200);
    expect((await call('func2', 'GET', '/api/me')).status).toBe(401);
    await expect(login(ctx.app, 'func2@teste.com', PASSWORD)).rejects.toThrow();
    expect((await call('gest', 'POST', `/api/cards/${t.id}/delegate`, { toUserId: ctx.users.func2.id })).status).toBe(403);
    const ft = await newTask(ctx, 'func', 'Do func');
    const targets = (await call('func', 'GET', `/api/cards/${ft.id}/transfer-targets`)).body;
    expect(targets.map((x: any) => x.id)).not.toContain(ctx.users.func2.id);
    const me = (await call('gest', 'GET', '/api/me')).body;
    expect(me.directReports.map((r: any) => r.id)).not.toContain(ctx.users.func2.id);
    // reativar devolve o acesso
    await call('admin', 'POST', `/api/admin/users/${ctx.users.func2.id}/active`, { active: true });
    expect(await login(ctx.app, 'func2@teste.com', PASSWORD)).toContain('synctasks_sid=');
  });
});

describe('código da tarefa (RN-45, RN-47)', () => {
  it('nunca é reutilizado, mesmo depois de cancelar; transferir, redelegar e reabrir mantêm o código', async () => {
    const t = await newTask(ctx, 'gest', 'Base');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`);
    const next = await newTask(ctx, 'gest', 'Depois');
    expect(Number(next.code.slice(3))).toBeGreaterThan(Number(d.code.slice(3)));
    const all = await ctx.pool.query('SELECT code FROM cards');
    expect(new Set(all.rows.map((r) => r.code)).size).toBe(all.rows.length);
  });
});

describe('conta e sessão', () => {
  it('sair invalida a sessão', async () => {
    const cookie = ctx.users.func.cookie;
    await ctx.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, 'x-synctasks': '1' } });
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
  });

  it('muitas senhas erradas bloqueiam o e-mail por 15 minutos', async () => {
    for (let i = 0; i < 10; i++) {
      const r = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-synctasks': '1' }, payload: { email: 'func@teste.com', password: `errada${i}` } });
      expect(r.statusCode).toBe(401);
    }
    const blocked = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-synctasks': '1' }, payload: { email: 'func@teste.com', password: PASSWORD } });
    expect(blocked.statusCode).toBe(429);
    // outra pessoa não é afetada
    expect(await login(ctx.app, 'func2@teste.com', PASSWORD)).toContain('synctasks_sid=');
  });

  it('“esqueci minha senha” não revela se o e-mail existe; o link vale uma vez e exige 8 caracteres', async () => {
    const post = (url: string, payload: object) => ctx.app.inject({ method: 'POST', url, headers: { 'x-synctasks': '1' }, payload });
    const unknown = await post('/api/auth/password/forgot', { email: 'ninguem@teste.com' });
    const known = await post('/api/auth/password/forgot', { email: 'func@teste.com' });
    expect([unknown.statusCode, unknown.body]).toEqual([known.statusCode, known.body]);
    const mail = await ctx.pool.query(`SELECT body FROM email_outbox WHERE to_email = 'func@teste.com' ORDER BY created_at DESC LIMIT 1`);
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail.rows[0].body)![1];
    expect((await post('/api/auth/password/set', { token, password: 'curta' })).statusCode).toBe(422);
    expect((await post('/api/auth/password/set', { token, password: 'nova-senha-123' })).statusCode).toBe(200);
    expect((await post('/api/auth/password/set', { token, password: 'outra-senha-123' })).statusCode).toBe(422);
    // a sessão antiga cai e a senha nova funciona
    expect((await call('func', 'GET', '/api/me')).status).toBe(401);
    expect(await login(ctx.app, 'func@teste.com', 'nova-senha-123')).toContain('synctasks_sid=');
  });

  it('administração valida e-mail repetido, CEO duplicado e não deixa o admin se desativar', async () => {
    const dup = await call('admin', 'POST', '/api/admin/users', { name: 'Repetido', email: 'FUNC@teste.com', level: 3, managerId: ctx.users.gest.id });
    expect(dup.status).toBe(409);
    expect((await call('admin', 'POST', '/api/admin/users', { name: 'Outro CEO', email: 'ceo2@teste.com', level: 0 })).status).toBe(409);
    expect((await call('admin', 'POST', '/api/admin/users', { name: 'Sem e-mail', email: 'invalido', level: 3, managerId: ctx.users.gest.id })).status).toBe(422);
    expect((await call('admin', 'POST', `/api/admin/users/${ctx.users.admin.id}/active`, { active: false })).status).toBe(409);
    expect((await call('admin', 'PATCH', `/api/admin/users/${ctx.users.admin.id}`, { isAdmin: false })).status).toBe(409);
  });
});

describe('várias tarefas de uma vez (item 30)', () => {
  it('cria uma tarefa por linha, na ordem, cada uma com código próprio e log; limite de 50', async () => {
    const listId = await firstListOf(ctx, 'func');
    const r = await call('func', 'POST', '/api/cards/batch', { listId, titles: [' Ligar ', '', 'Enviar proposta', 'Revisar'] });
    expect(r.status).toBe(200);
    expect(r.body.cards.map((c: { title: string }) => c.title)).toEqual(['Ligar', 'Enviar proposta', 'Revisar']);
    expect(new Set(r.body.cards.map((c: { code: string }) => c.code)).size).toBe(3);
    const rows = await ctx.pool.query('SELECT title FROM cards WHERE list_id = $1 AND archived_at IS NULL ORDER BY position', [listId]);
    expect(names(rows.rows.map((x) => ({ name: x.title }))).slice(-3)).toEqual(['Ligar', 'Enviar proposta', 'Revisar']);
    const ev = await ctx.pool.query("SELECT count(*)::int AS n FROM card_events WHERE type = 'created' AND card_id = ANY($1::uuid[])", [r.body.cards.map((c: { id: string }) => c.id)]);
    expect(ev.rows[0].n).toBe(3);

    expect((await call('func', 'POST', '/api/cards/batch', { listId, titles: Array.from({ length: 51 }, (_, i) => `T${i}`) })).status).toBe(422);
    expect((await call('func', 'POST', '/api/cards/batch', { listId, titles: ['ok', 'x'.repeat(201)] })).status).toBe(422);
    expect((await call('func', 'POST', '/api/cards/batch', { listId, titles: ['  ', ''] })).status).toBe(422);
    // tudo ou nada: o título longo recusou o lote inteiro
    expect((await ctx.pool.query("SELECT 1 FROM cards WHERE title = 'ok'")).rowCount).toBe(0);
  });

  it('uma tarefa só com descrição; desfazer arquiva só as próprias recém-criadas e sem delegação', async () => {
    const listId = await firstListOf(ctx, 'gest');
    const one = await call('gest', 'POST', '/api/cards', { listId, title: 'Reunião', description: '- pauta 1\n- pauta 2' });
    expect((await call('gest', 'GET', `/api/cards/${one.body.id}`)).body.card.description).toBe('- pauta 1\n- pauta 2');

    const ids = (await call('gest', 'POST', '/api/cards/batch', { listId, titles: ['A', 'B', 'C'] })).body.cards.map((c: { id: string }) => c.id);
    await delegateTask(ctx, 'gest', ids[2], 'func');
    expect((await call('func', 'POST', '/api/cards/undo-create', { ids })).status).toBe(403);
    const u = await call('gest', 'POST', '/api/cards/undo-create', { ids });
    expect(u.status).toBe(200);
    expect(u.body.archived).toBe(2);
    const st = await ctx.pool.query('SELECT title, archived_at IS NOT NULL AS arch FROM cards WHERE id = ANY($1::uuid[]) ORDER BY title', [ids]);
    expect(st.rows).toEqual([{ title: 'A', arch: true }, { title: 'B', arch: true }, { title: 'C', arch: false }]);
    const log = await ctx.pool.query("SELECT after FROM card_events WHERE card_id = $1 AND type = 'archived'", [ids[0]]);
    expect(log.rows[0].after).toEqual({ undo: true });
  });
});
