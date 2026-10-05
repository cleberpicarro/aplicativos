import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, day, login, PASSWORD, type Ctx } from './helpers.js';
import { processOutbox } from '../src/lib/mailer.js';

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

describe('segurança básica', () => {
  it('recusa alteração sem o cabeçalho anti-CSRF', async () => {
    const r = await ctx.app.inject({ method: 'POST', url: '/api/boards', headers: { cookie: ctx.users.gest.cookie }, payload: { name: 'X' } });
    expect(r.statusCode).toBe(403);
  });
  it('login com senha errada retorna 401 e sem sessão retorna 401', async () => {
    await expect(login(ctx.app, 'gest@teste.com', 'errada')).rejects.toThrow();
    const r = await ctx.app.inject({ method: 'GET', url: '/api/me' });
    expect(r.statusCode).toBe(401);
  });
  it('login funciona com e-mail em maiúsculas', async () => {
    expect(await login(ctx.app, 'GEST@teste.com', PASSWORD)).toContain('synctasks_sid=');
  });
});

describe('delegação (RN-14 a RN-19)', () => {
  it('só o superior direto delega, para subordinado direto', async () => {
    const t = await newTask(ctx, 'gest', 'Tarefa do gestor');
    expect((await call('gest', 'POST', `/api/cards/${t.id}/delegate`, { toUserId: ctx.users.func3.id })).status).toBe(403); // não é subordinado direto
    const td = await newTask(ctx, 'dir', 'Tarefa do diretor');
    expect((await call('dir', 'POST', `/api/cards/${td.id}/delegate`, { toUserId: ctx.users.func.id })).status).toBe(403); // pula nível
    const tf = await newTask(ctx, 'func', 'Tarefa do funcionário');
    expect((await call('func', 'POST', `/api/cards/${tf.id}/delegate`, { toUserId: ctx.users.gest.id })).status).toBe(403); // para cima
    expect((await call('gest', 'POST', `/api/cards/${t.id}/delegate`, { toUserId: ctx.users.func.id })).status).toBe(200);
  });

  it('cria um cartão novo, com código próprio, ligado ao de origem, na caixa de entrada', async () => {
    const t = await newTask(ctx, 'gest', 'Levantar custos', day(5));
    const d = await delegateTask(ctx, 'gest', t.id, 'func', { note: 'Preciso por categoria.' });
    expect(d.code).not.toBe(t.code);
    expect(d.code).toMatch(/^ST-\d{6}$/);
    const inbox = (await call('func', 'GET', '/api/inbox')).body;
    expect(inbox.map((c: any) => c.code)).toContain(d.code);
    const child = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body;
    expect(child.card.delegation.parentCode).toBe(t.code);
    expect(child.card.dueDate).toBe(day(5));
    expect(child.comments[0].body).toBe('Preciso por categoria.');
    const parent = (await call('gest', 'GET', `/api/cards/${t.id}`)).body;
    expect(parent.card.child.code).toBe(d.code);
    expect(parent.card.child.status).toBe('PENDING_ACCEPT');
    // só uma delegação ativa por cartão
    expect((await call('gest', 'POST', `/api/cards/${t.id}/delegate`, { toUserId: ctx.users.func2.id })).status).toBe(409);
  });

  it('devolver exige justificativa e a tarefa volta ao delegador', async () => {
    const t = await newTask(ctx, 'gest', 'Treinar equipe nova');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: '' })).status).toBe(422);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Prazo inviável' })).status).toBe(200);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).status).toBe(404); // sai de quem recebeu
    const ov = (await call('gest', 'GET', '/api/delegations')).body;
    expect(ov.needAction.map((c: any) => c.code)).toContain(d.code);
    expect(ov.needAction[0].delegation.declineReason).toBe('Prazo inviável');
  });

  it('concluir → aguardando ciente → ciente arquiva; reabrir exige comentário', async () => {
    const t = await newTask(ctx, 'gest', 'Relatório semanal');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/complete`)).status).toBe(409); // precisa aceitar antes
    await acceptTask(ctx, 'func', d.cardId);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/complete`)).status).toBe(200);
    let card = (await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(card.delegation.status).toBe('AWAITING_ACK');

    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/reopen`, { comment: '' })).status).toBe(422);
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/reopen`, { comment: 'Faltou o anexo do mês' })).status).toBe(200);
    card = (await call('func', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(card.delegation.status).toBe('IN_PROGRESS');
    expect(card.delegation.reopened).toBe(true);
    expect(card.completedAt).toBeNull();

    await call('func', 'POST', `/api/cards/${d.cardId}/complete`);
    expect((await call('func', 'POST', `/api/delegations/${d.delegationId}/ack`)).status).toBe(404); // só o delegador
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/ack`)).status).toBe(200);
    card = (await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(card.archivedAt).not.toBeNull();
    expect(card.delegation.status).toBe('ACKED');
    const ov = (await call('gest', 'GET', '/api/delegations')).body;
    expect(ov.needAction).toHaveLength(0);
  });

  it('redelegar mantém o código; cancelar arquiva e libera o cartão de origem', async () => {
    const t = await newTask(ctx, 'gest', 'Mapear processos');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await call('func', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'Estou de férias' });
    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/redelegate`, { toUserId: ctx.users.func2.id })).status).toBe(200);
    const inbox2 = (await call('func2', 'GET', '/api/inbox')).body;
    expect(inbox2.map((c: any) => c.code)).toEqual([d.code]);

    expect((await call('gest', 'POST', `/api/delegations/${d.delegationId}/cancel`)).status).toBe(200);
    expect((await call('func2', 'GET', '/api/inbox')).body).toHaveLength(0);
    const again = await delegateTask(ctx, 'gest', t.id, 'func');
    expect(again.code).not.toBe(d.code);
  });

  it('prazo alterado pelo subordinado avisa o delegador por e-mail', async () => {
    const t = await newTask(ctx, 'gest', 'Conferir notas', day(3));
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}`, { dueDate: day(6) })).status).toBe(200);
    const notes = (await call('gest', 'GET', '/api/notifications')).body;
    expect(notes[0].type).toBe('due_changed');
    const mail = await ctx.pool.query(`SELECT subject FROM email_outbox WHERE to_email = 'gest@teste.com' ORDER BY created_at DESC LIMIT 1`);
    expect(mail.rows[0].subject).toContain(`[${d.code}]`);
  });

  it('tarefa recebida por delegação não pode ser privada', async () => {
    const t = await newTask(ctx, 'gest', 'X');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}`, { isPrivate: true })).status).toBe(409);
  });

  it('cadeia: diretor → gestor → funcionário, com ícone de repasse visível ao diretor', async () => {
    const t = await newTask(ctx, 'dir', 'Orçamento 2027');
    const dg = await delegateTask(ctx, 'dir', t.id, 'gest');
    await acceptTask(ctx, 'gest', dg.cardId);
    const df = await delegateTask(ctx, 'gest', dg.cardId, 'func');
    const ov = (await call('dir', 'GET', '/api/delegations')).body;
    const gestGroup = ov.groups.find((g: any) => g.person.id === ctx.users.gest.id);
    expect(gestGroup.tasks[0].child.code).toBe(df.code);
    // o diretor não vê a delegação feita pelo gestor na própria tela
    expect(ov.groups.some((g: any) => g.tasks.some((c: any) => c.code === df.code))).toBe(false);
  });
});

describe('transferência (RN-30 a RN-33)', () => {
  it('respeita destinos; numa tarefa delegada o delegador continua acompanhando', async () => {
    const t = await newTask(ctx, 'gest', 'Tarefa');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const targets = (await call('func', 'GET', `/api/cards/${d.cardId}/transfer-targets`)).body;
    expect(targets.map((x: any) => x.id)).toEqual([ctx.users.func2.id]); // colega; o delegador (gestor) fica de fora
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/transfer`, { toUserId: ctx.users.func3.id })).status).toBe(403);
    expect((await call('func', 'POST', `/api/cards/${d.cardId}/transfer`, { toUserId: ctx.users.func2.id })).status).toBe(200);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}`)).status).toBe(404); // quem transferiu deixa de acompanhar
    const seen = (await call('gest', 'GET', `/api/cards/${d.cardId}`)).body.card;
    expect(seen.ownerId).toBe(ctx.users.func2.id);
    expect(seen.code).toBe(d.code);
    expect((await call('func2', 'GET', '/api/inbox')).body[0].transferredFrom.id).toBe(ctx.users.func.id);
    // tarefa transferida não pode ser devolvida pela caixa de entrada
    expect((await call('func2', 'POST', `/api/cards/${d.cardId}/decline`, { reason: 'não quero' })).status).toBe(409);
  });

  it('tarefa própria: pode ir ao superior direto', async () => {
    const t = await newTask(ctx, 'func', 'Ideia');
    expect((await call('func', 'POST', `/api/cards/${t.id}/transfer`, { toUserId: ctx.users.gest.id })).status).toBe(200);
    expect((await call('gest', 'GET', '/api/inbox')).body.map((c: any) => c.code)).toContain(t.code);
  });
});

describe('visibilidade (RN-34, RN-35, seção 5)', () => {
  it('superior não vê tarefas próprias nem privadas; contador “próprias” ignora as privadas', async () => {
    const own = await newTask(ctx, 'func', 'Tarefa própria');
    const priv = await newTask(ctx, 'func', 'Privada');
    await call('func', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true });
    expect((await call('gest', 'GET', `/api/cards/${own.id}`)).status).toBe(404);
    expect((await call('ceo', 'GET', `/api/cards/${priv.id}`)).status).toBe(404);
    const ov = (await call('gest', 'GET', '/api/delegations')).body;
    const g = ov.groups.find((x: any) => x.person.id === ctx.users.func.id);
    expect(g.counts.own).toBe(1);
  });

  it('diretor de outra diretoria não acessa a tarefa', async () => {
    const t = await newTask(ctx, 'func', 'Algo');
    expect((await call('dir2', 'GET', `/api/cards/${t.id}`)).status).toBe(404);
    expect((await call('dir', 'GET', `/api/cards/${t.id}`)).status).toBe(200); // diretor da linha: acesso de auditoria
  });

  it('contadores: abertas, atrasadas, aguardando ciente, devolvidas', async () => {
    const a = await newTask(ctx, 'gest', 'Atrasada', day(-2));
    const b = await newTask(ctx, 'gest', 'Concluída');
    const c = await newTask(ctx, 'gest', 'Devolvida');
    await delegateTask(ctx, 'gest', a.id, 'func');
    const db = await delegateTask(ctx, 'gest', b.id, 'func');
    const dc = await delegateTask(ctx, 'gest', c.id, 'func');
    await acceptTask(ctx, 'func', db.cardId);
    await call('func', 'POST', `/api/cards/${db.cardId}/complete`);
    await call('func', 'POST', `/api/cards/${dc.cardId}/decline`, { reason: 'Sem tempo' });
    const g = (await call('gest', 'GET', '/api/delegations')).body.groups.find((x: any) => x.person.id === ctx.users.func.id);
    expect(g.counts).toMatchObject({ open: 1, late: 1, awaitingAck: 1, declined: 1 });
  });
});

describe('log da tarefa (seção 10)', () => {
  it('registra eventos, é imutável e só administração, CEO e diretoria veem', async () => {
    const t = await newTask(ctx, 'gest', 'Título antigo');
    await call('gest', 'PATCH', `/api/cards/${t.id}`, { title: 'Título novo', dueDate: day(4) });
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    await call('func', 'POST', `/api/cards/${d.cardId}/checklist`, { text: 'Primeiro passo' });

    expect((await call('gest', 'GET', `/api/cards/${t.id}/events`)).status).toBe(403);
    expect((await call('func', 'GET', `/api/cards/${d.cardId}/events`)).status).toBe(403);
    const ev = (await call('dir', 'GET', `/api/cards/${t.id}/events`)).body;
    expect(ev.map((e: any) => e.type)).toEqual(['created', 'title_changed', 'due_changed', 'delegated_down']);
    expect(ev[1].before).toEqual({ title: 'Título antigo' });
    expect(ev[1].after).toEqual({ title: 'Título novo' });
    const childEv = (await call('admin', 'GET', `/api/cards/${d.cardId}/events`)).body;
    expect(childEv.map((e: any) => e.type)).toEqual(['delegated', 'accepted', 'checklist_added']);
    expect((await call('ceo', 'GET', `/api/cards/${d.cardId}/events`)).status).toBe(200);
    expect((await call('dir2', 'GET', `/api/cards/${d.cardId}/events`)).status).toBe(404);

    await expect(ctx.pool.query('UPDATE card_events SET type = $1', ['x'])).rejects.toThrow(/somente inserção/);
    await expect(ctx.pool.query('DELETE FROM card_events')).rejects.toThrow(/somente inserção/);
    await expect(ctx.pool.query('DELETE FROM comments')).resolves.toBeDefined(); // sem linhas: trigger por linha não dispara
  });
});

describe('quadros, fases e checklist', () => {
  it('arquivar fase com tarefas retorna 409; vazia arquiva', async () => {
    const t = await newTask(ctx, 'func', 'Algo');
    expect((await call('func', 'POST', `/api/lists/${t.listId}/archive`)).status).toBe(409);
    const empty = t.lists[1].id;
    expect((await call('func', 'POST', `/api/lists/${empty}/archive`)).status).toBe(200);
    expect((await call('func', 'PATCH', `/api/lists/${t.listId}`, { name: 'Hoje' })).status).toBe(200);
  });

  it('checklist: só quem tem a tarefa edita', async () => {
    const t = await newTask(ctx, 'gest', 'Com checklist');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    await acceptTask(ctx, 'func', d.cardId);
    const item = (await call('func', 'POST', `/api/cards/${d.cardId}/checklist`, { text: 'Passo 1' })).body;
    expect((await call('func', 'PATCH', `/api/cards/${d.cardId}/checklist/${item.id}`, { done: true })).status).toBe(200);
    expect((await call('gest', 'POST', `/api/cards/${d.cardId}/checklist`, { text: 'Intruso' })).status).toBe(403);
    const card = (await call('gest', 'GET', '/api/delegations')).body.groups.find((g: any) => g.person.id === ctx.users.func.id).tasks[0];
    expect(card.checklist).toEqual({ done: 1, total: 1 });
  });

  it('mover entre fases', async () => {
    const t = await newTask(ctx, 'func', 'Mover');
    expect((await call('func', 'POST', `/api/cards/${t.id}/move`, { listId: t.lists[2].id })).status).toBe(200);
    const c = (await call('func', 'GET', `/api/cards/${t.id}`)).body.card;
    expect(c.listId).toBe(t.lists[2].id);
  });
});

describe('código da tarefa (seção 8)', () => {
  it('tem 6 dígitos no mínimo e passa de 999.999 sem erro', async () => {
    const a = await newTask(ctx, 'func', 'A');
    expect(a.code).toMatch(/^ST-0000\d\d$/);
    await ctx.pool.query(`SELECT setval('card_code_seq', 999999, false)`);
    const b = await newTask(ctx, 'func', 'B');
    const c = await newTask(ctx, 'func', 'C');
    expect(b.code).toBe('ST-999999');
    expect(c.code).toBe('ST-1000000');
    const found = (await call('func', 'GET', '/api/search?q=1000000')).body;
    expect(found.byCode.code).toBe('ST-1000000');
  });
});

describe('busca (RN-36, RN-37)', () => {
  it('encontra por código e por texto, só no que a pessoa pode ver', async () => {
    const t = await newTask(ctx, 'func', 'Conferir notas fiscais');
    await call('func', 'PATCH', `/api/cards/${t.id}`, { description: 'Cruzar com o extrato bancário' });
    const num = Number(t.code.slice(3));
    expect((await call('func', 'GET', `/api/search?q=${encodeURIComponent(`nt${num}`)}`)).body.byCode.id).toBe(t.id);
    expect((await call('func', 'GET', '/api/search?q=extrato')).body.results.map((c: any) => c.id)).toContain(t.id);
    expect((await call('func', 'GET', '/api/search?q=fisc')).body.results.map((c: any) => c.id)).toContain(t.id);
    expect((await call('func2', 'GET', '/api/search?q=extrato')).body.results).toHaveLength(0);
    expect((await call('func2', 'GET', `/api/search?q=${t.code}`)).body.byCode).toBeNull();
  });
});

describe('administração (seção 4.2 e 7.9)', () => {
  it('só administrador acessa; valida o nível do superior', async () => {
    expect((await call('gest', 'GET', '/api/admin/users')).status).toBe(403);
    const bad = await call('admin', 'POST', '/api/admin/users', { name: 'Novo', email: 'novo@teste.com', level: 3, managerId: ctx.users.dir.id });
    expect(bad.status).toBe(422);
    const ok = await call('admin', 'POST', '/api/admin/users', { name: 'Novo Func', email: 'novo@teste.com', level: 3, managerId: ctx.users.gest.id });
    expect(ok.status).toBe(200);
    const mail = await ctx.pool.query(`SELECT body FROM email_outbox WHERE to_email = 'novo@teste.com'`);
    const token = /token=([\w-]+)/.exec(mail.rows[0].body)![1];
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/password/set', headers: { 'x-synctasks': '1' }, payload: { token, password: 'curta' } })).statusCode).toBe(422);
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/password/set', headers: { 'x-synctasks': '1' }, payload: { token, password: 'uma-senha-boa' } })).statusCode).toBe(200);
    expect(await login(ctx.app, 'novo@teste.com', 'uma-senha-boa')).toContain('synctasks_sid=');
    // link de uso único
    expect((await ctx.app.inject({ method: 'POST', url: '/api/auth/password/set', headers: { 'x-synctasks': '1' }, payload: { token, password: 'outra-senha-boa' } })).statusCode).toBe(422);
  });

  it('transferir gestão move as delegações em aberto e mantém o histórico com o antigo', async () => {
    const t1 = await newTask(ctx, 'gest', 'Aberta');
    const t2 = await newTask(ctx, 'gest', 'Já com ciente');
    const d1 = await delegateTask(ctx, 'gest', t1.id, 'func');
    const d2 = await delegateTask(ctx, 'gest', t2.id, 'func');
    await acceptTask(ctx, 'func', d2.cardId);
    await call('func', 'POST', `/api/cards/${d2.cardId}/complete`);
    await call('gest', 'POST', `/api/delegations/${d2.delegationId}/ack`);

    const r = await call('admin', 'POST', `/api/admin/users/${ctx.users.func.id}/transfer-management`, { managerId: ctx.users.gest2.id });
    expect(r.body.moved).toBe(1);
    const ov2 = (await call('gest2', 'GET', '/api/delegations')).body;
    expect(ov2.groups.find((g: any) => g.person.id === ctx.users.func.id).tasks.map((c: any) => c.code)).toEqual([d1.code]);
    const ov1 = (await call('gest', 'GET', '/api/delegations?archived=1')).body;
    expect(ov1.groups.flatMap((g: any) => g.tasks).map((c: any) => c.code)).toEqual([d2.code]);
    expect((await call('gest2', 'POST', `/api/delegations/${d1.delegationId}/cancel`)).status).toBe(200);
    const notes = (await call('func', 'GET', '/api/notifications')).body.map((n: any) => n.type);
    expect(notes).toContain('management');
  });

  it('não desativa quem tem subordinados ou delegações em aberto', async () => {
    const r = await call('admin', 'POST', `/api/admin/users/${ctx.users.gest.id}/active`, { active: false });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('subordinado');
    expect((await call('admin', 'POST', `/api/admin/users/${ctx.users.func2.id}/active`, { active: false })).status).toBe(200);
    expect((await call('func2', 'GET', '/api/me')).status).toBe(401); // sessão encerrada
  });
});

describe('avisos e e-mails (seção 11)', () => {
  it('cada evento gera aviso no app e e-mail com o código no assunto', async () => {
    const t = await newTask(ctx, 'gest', 'Enviar relatório');
    const d = await delegateTask(ctx, 'gest', t.id, 'func');
    const notes = (await call('func', 'GET', '/api/notifications')).body;
    expect(notes[0]).toMatchObject({ type: 'delegated', card_code: d.code });
    expect((await call('func', 'GET', '/api/me')).body.counts.unread).toBe(1);
    await call('func', 'POST', '/api/notifications/read');
    expect((await call('func', 'GET', '/api/me')).body.counts.unread).toBe(0);

    const sent: string[] = [];
    const n = await processOutbox(ctx.pool, { send: async (to, subject) => void sent.push(`${to}|${subject}`) });
    expect(n).toBeGreaterThan(0);
    expect(sent.some((s) => s.startsWith('func@teste.com|') && s.includes(`[${d.code}]`))).toBe(true);
  });

  it('falha de envio fica pendente e para após 5 tentativas', async () => {
    const t = await newTask(ctx, 'gest', 'X');
    await delegateTask(ctx, 'gest', t.id, 'func');
    await ctx.pool.query('DELETE FROM email_outbox WHERE to_email <> $1', ['func@teste.com']);
    const failing = { send: async () => { throw new Error('SMTP fora'); } };
    for (let i = 0; i < 5; i++) await processOutbox(ctx.pool, failing);
    const r = await ctx.pool.query(`SELECT status, attempts FROM email_outbox WHERE to_email = 'func@teste.com'`);
    expect(r.rows.every((x) => x.status === 'failed' && x.attempts === 5)).toBe(true);
  });
});

describe('fluxo ponta a ponta (critério 15)', () => {
  it('diretor → gestor → funcionário → ciente em cadeia', async () => {
    const t = await newTask(ctx, 'dir', 'Plano de capacidade');
    const dg = await delegateTask(ctx, 'dir', t.id, 'gest');
    await acceptTask(ctx, 'gest', dg.cardId);
    const df = await delegateTask(ctx, 'gest', dg.cardId, 'func');
    await acceptTask(ctx, 'func', df.cardId);
    await call('func', 'POST', `/api/cards/${df.cardId}/complete`);
    expect((await call('gest', 'POST', `/api/delegations/${df.delegationId}/ack`)).status).toBe(200);
    expect((await call('gest', 'POST', `/api/cards/${dg.cardId}/complete`)).status).toBe(200);
    expect((await call('dir', 'POST', `/api/delegations/${dg.delegationId}/ack`)).status).toBe(200);
    const parent = (await call('dir', 'GET', `/api/cards/${t.id}`)).body.card;
    expect(parent.child.status).toBe('ACKED');
  });
});

describe('importação do Trello', () => {
  it('cria um quadro novo com fases, tarefas, checklist, comentários e log', async () => {
    const { readFileSync } = await import('node:fs');
    const { parseTrello } = await import('../../web/src/lib/trello.js');
    const raw = JSON.parse(readFileSync(new URL('../../web/src/lib/__fixtures__/trello-board.json', import.meta.url), 'utf8'));
    const { payload } = parseTrello(raw);
    const r = await call('gest', 'POST', '/api/import/trello', payload);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ lists: 3, cards: 4, checklistItems: 3, comments: 2 });

    const board = (await call('gest', 'GET', `/api/boards/${r.body.boardId}`)).body;
    expect(board.name).toBe('Marketing 2026');
    expect(board.lists.map((l: any) => l.name)).toEqual(['A fazer', 'Em andamento', 'Concluído']);
    const camp = board.cards.find((c: any) => c.title === 'Campanha de lançamento');
    expect(camp.code).toMatch(/^ST-\d{6}$/);
    expect(camp.checklist).toEqual({ done: 1, total: 3 });
    expect(board.cards.find((c: any) => c.title === 'Fotos do evento').completedAt).not.toBeNull();

    const detail = (await call('gest', 'GET', `/api/cards/${camp.id}`)).body;
    expect(detail.card.description).toContain('Membros no Trello: Ana Souza, Bruno Lima');
    expect(detail.comments.map((c: any) => c.body)).toEqual([
      'Comentário de Ana Souza no Trello em 30/09/2026 06:15:\nVamos começar pelo público-alvo.',
      'Comentário de Bruno Lima no Trello em 02/10/2026 10:30:\nOrçamento enviado para aprovação.',
    ]);
    const ev = (await call('admin', 'GET', `/api/cards/${camp.id}/events`)).body;
    expect(ev[0]).toMatchObject({ type: 'imported', after: { source: 'Trello', board: 'Marketing 2026', list: 'A fazer' } });

    // o quadro é só de quem importou
    expect((await call('func', 'GET', `/api/boards/${r.body.boardId}`)).status).toBe(404);
  });

  it('valida o conteúdo e recusa quem não tem quadros', async () => {
    expect((await call('gest', 'POST', '/api/import/trello', { boardName: 'X', lists: [] })).status).toBe(422);
    const ok = { boardName: 'X', lists: [{ name: 'L', cards: [] }] };
    expect((await call('admin', 'POST', '/api/import/trello', ok)).status).toBe(403);
    expect((await call('gest', 'POST', '/api/import/trello', ok)).status).toBe(200);
  });
});

describe('terceira rodada', () => {
  it('código ST- e links antigos com NT- continuam funcionando', async () => {
    const t = await newTask(ctx, 'func', 'Código novo');
    expect(t.code).toMatch(/^ST-\d{6}$/);
    const legacy = t.code.replace('ST-', 'NT-');
    expect((await call('func', 'GET', `/api/cards/by-code/${legacy}`)).body.card.id).toBe(t.id);
    expect((await call('func', 'GET', `/api/search?q=${legacy}`)).body.byCode.id).toBe(t.id);
  });

  it('ordena a fase por nome, criação e prazo (item 11)', async () => {
    const b = await newTask(ctx, 'func', 'Banana', day(1));
    await newTask(ctx, 'func', 'abacaxi', day(5));
    await newTask(ctx, 'func', 'Cereja');
    const order = async () => {
      const boards = (await call('func', 'GET', '/api/boards')).body;
      const board = (await call('func', 'GET', `/api/boards/${boards[0].id}`)).body;
      return board.cards.filter((x: any) => x.listId === b.listId).sort((x: any, y: any) => x.position - y.position).map((x: any) => x.title);
    };
    await call('func', 'POST', `/api/lists/${b.listId}/sort`, { by: 'title' });
    expect(await order()).toEqual(['abacaxi', 'Banana', 'Cereja']);
    await call('func', 'POST', `/api/lists/${b.listId}/sort`, { by: 'due' });
    expect(await order()).toEqual(['Banana', 'abacaxi', 'Cereja']);
    await call('func', 'POST', `/api/lists/${b.listId}/sort`, { by: 'created' });
    expect(await order()).toEqual(['Banana', 'abacaxi', 'Cereja']);
    expect((await call('func', 'POST', `/api/lists/${b.listId}/sort`, { by: 'cor' })).status).toBe(422);
    expect((await call('func2', 'POST', `/api/lists/${b.listId}/sort`, { by: 'title' })).status).toBe(404);
  });

  it('cor do quadro (item 12)', async () => {
    const boards = (await call('func', 'GET', '/api/boards')).body;
    expect((await call('func', 'PATCH', `/api/boards/${boards[0].id}`, { color: 'azul' })).status).toBe(200);
    expect((await call('func', 'GET', `/api/boards/${boards[0].id}`)).body.color).toBe('azul');
    expect((await call('func', 'PATCH', `/api/boards/${boards[0].id}`, { color: 'neon' })).status).toBe(422);
    expect((await call('func', 'PATCH', `/api/boards/${boards[0].id}`, { color: null })).status).toBe(200);
    expect((await call('func2', 'PATCH', `/api/boards/${boards[0].id}`, { color: 'azul' })).status).toBe(404);
  });

  it('move para outro quadro, para o topo e para o fim (itens 10 e 16)', async () => {
    const t1 = await newTask(ctx, 'func', 'Primeira');
    await newTask(ctx, 'func', 'Segunda');
    const other = (await call('func', 'POST', '/api/boards', { name: 'Pessoal' })).body;
    const otherBoard = (await call('func', 'GET', `/api/boards/${other.id}`)).body;
    expect((await call('func', 'POST', `/api/cards/${t1.id}/move`, { listId: otherBoard.lists[1].id })).status).toBe(200);
    const ev = (await call('admin', 'GET', `/api/cards/${t1.id}/events`)).body.at(-1);
    expect(ev).toMatchObject({ type: 'moved', before: { board: 'Meu trabalho', list: 'A fazer' }, after: { board: 'Pessoal', list: 'Fazendo' } });
    // topo / fim dentro da fase
    const t3 = await newTask(ctx, 'func', 'Terceira');
    await call('func', 'POST', `/api/cards/${t3.id}/move`, { listId: t3.listId, place: 'top' });
    const order = async () => {
      const board = (await call('func', 'GET', `/api/boards/${(await call('func', 'GET', '/api/boards')).body[0].id}`)).body;
      return board.cards.filter((x: any) => x.listId === t3.listId).sort((x: any, y: any) => x.position - y.position).map((x: any) => x.title);
    };
    expect(await order()).toEqual(['Terceira', 'Segunda']);
    await call('func', 'POST', `/api/cards/${t3.id}/move`, { listId: t3.listId, place: 'end' });
    expect(await order()).toEqual(['Segunda', 'Terceira']);
  });

  it('captura da web vai para a caixa de entrada (item 14)', async () => {
    const r = await call('func', 'POST', '/api/capture', { title: 'Artigo sobre gestão', url: 'https://exemplo.com/artigo', text: 'trecho importante' });
    expect(r.status).toBe(200);
    expect(r.body.code).toMatch(/^ST-/);
    const inbox = (await call('func', 'GET', '/api/inbox')).body;
    const c = inbox.find((x: any) => x.id === r.body.id);
    expect(c).toMatchObject({ source: 'web', title: 'Artigo sobre gestão', inInbox: true });
    expect(c.description).toBe('https://exemplo.com/artigo\n\n“trecho importante”');
    await acceptTask(ctx, 'func', r.body.id);
    expect((await call('func', 'POST', `/api/cards/${r.body.id}/complete`)).status).toBe(200);
    // sem título: usa o domínio
    const r2 = await call('func', 'POST', '/api/capture', { title: '', url: 'https://www.exemplo.com.br/x' });
    expect((await call('func', 'GET', `/api/cards/${r2.body.id}`)).body.card.title).toBe('www.exemplo.com.br');
    expect((await call('func', 'POST', '/api/capture', { title: 'x', url: 'javascript:alert(1)' })).status).toBe(422);
    expect((await call('admin', 'POST', '/api/capture', { title: 'x', url: 'https://a.com' })).status).toBe(403);
  });

  it('e-mail aberto no Gmail vira tarefa com o assunto e o link da mensagem (item 21)', async () => {
    const url = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWcbmnqDpFGHJKLzxcvbnm';
    const r = await call('func', 'POST', '/api/capture', { title: 'Proposta comercial revisada - joao@nerus.com.br - Gmail', url });
    expect(r.status).toBe(200);
    const c = (await call('func', 'GET', `/api/cards/${r.body.id}`)).body.card;
    expect(c).toMatchObject({ source: 'email', title: 'Proposta comercial revisada' });
    expect(c.description).toBe(url);
    expect((await call('admin', 'GET', `/api/cards/${r.body.id}/events`)).body.at(-1)).toMatchObject({ type: 'captured', after: { url, email: true } });
    // Gmail sem e-mail aberto (só a caixa de entrada) continua sendo página da web
    const r2 = await call('func', 'POST', '/api/capture', { title: 'Caixa de entrada (3) - joao@nerus.com.br - Gmail', url: 'https://mail.google.com/mail/u/0/#inbox' });
    expect((await call('func', 'GET', `/api/cards/${r2.body.id}`)).body.card.source).toBe('web');
  });

  it('compartilhar do Android leva à tela de captura, tirando o link do texto', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/compartilhar?title=Not%C3%ADcia&text=Veja%20isto%20https%3A%2F%2Fsite.com%2Fa' });
    expect(r.statusCode).toBe(302);
    const loc = new URLSearchParams(r.headers.location!.split('?')[1]);
    expect(r.headers.location).toMatch(/^\/#\/capturar\?/);
    expect(loc.get('url')).toBe('https://site.com/a');
    expect(loc.get('text')).toBe('Veja isto');
    expect(loc.get('title')).toBe('Notícia');
  });

  it('painel do gestor (item 17)', async () => {
    const late = await newTask(ctx, 'gest', 'Atrasada', day(-2));
    const soon = await newTask(ctx, 'gest', 'Vence logo', day(3));
    const later = await newTask(ctx, 'gest', 'Vence depois', day(20));
    const done = await newTask(ctx, 'gest', 'Concluída');
    const dl = await delegateTask(ctx, 'gest', late.id, 'func');
    const ds = await delegateTask(ctx, 'gest', soon.id, 'func');
    await delegateTask(ctx, 'gest', later.id, 'func2');
    const dd = await delegateTask(ctx, 'gest', done.id, 'func2');
    await acceptTask(ctx, 'func', ds.cardId);
    await acceptTask(ctx, 'func2', dd.cardId);
    await call('func2', 'POST', `/api/cards/${dd.cardId}/complete`);
    // simula tempo parado: aceite pendente e ciente pendente há 3 dias; sem movimento há 10 dias
    await ctx.pool.query(`UPDATE delegations SET updated_at = now() - interval '3 days' WHERE id IN ($1, $2)`, [dl.delegationId, dd.delegationId]);
    await ctx.pool.query('ALTER TABLE card_events DISABLE TRIGGER card_events_immutable');
    await ctx.pool.query(`UPDATE card_events SET created_at = now() - interval '10 days' WHERE card_id = $1`, [ds.cardId]);
    await ctx.pool.query('ALTER TABLE card_events ENABLE TRIGGER card_events_immutable');
    await ctx.pool.query(`UPDATE delegations SET updated_at = now() - interval '10 days' WHERE id = $1`, [ds.delegationId]);

    const r = await call('gest', 'GET', '/api/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.summary).toEqual({ open: 3, late: 1, awaitingAck: 1, declined: 0 });
    const f = r.body.people.find((p: any) => p.id === ctx.users.func.id);
    const f2 = r.body.people.find((p: any) => p.id === ctx.users.func2.id);
    expect(f).toMatchObject({ late: 1, dueSoon: 1, onTime: 0 });
    expect(f2).toMatchObject({ late: 0, dueSoon: 0, onTime: 1 });
    expect(r.body.agenda.overdue.map((c: any) => c.title)).toEqual(['Atrasada']);
    expect(r.body.agenda.days).toHaveLength(14);
    expect(r.body.agenda.days[3].cards.map((c: any) => c.title)).toEqual(['Vence logo']);
    expect(r.body.stalled.notAccepted.map((x: any) => x.card.title)).toEqual(['Atrasada']);
    expect(r.body.stalled.awaitingAck.map((x: any) => x.card.title)).toEqual(['Concluída']);
    expect(r.body.stalled.noMovement.map((x: any) => x.card.title)).toEqual(['Vence logo']);
    // funcionário sem equipe: painel vazio
    expect((await call('func', 'GET', '/api/dashboard')).body.summary).toEqual({ open: 0, late: 0, awaitingAck: 0, declined: 0 });
  });
});
