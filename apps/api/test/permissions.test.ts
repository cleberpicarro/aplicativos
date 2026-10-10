/**
 * Frente 2 do plano de testes: "ninguém vê nem mexe no que não é seu".
 * Cada pessoa da hierarquia tenta todas as ações sobre o quadro, as fases, as tarefas
 * e as delegações de outra pessoa. Toda tentativa precisa ser recusada e o banco
 * precisa ficar exatamente igual (fotografia antes e depois).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, acceptTask, firstListOf, day, type Ctx } from './helpers.js';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
interface Attempt { method: Method; url: string; body?: unknown; route: string }

let ctx: Ctx;
let call: ReturnType<typeof api>;
/** Cenário montado uma vez: tudo pertence ao gestor "gest" (ou foi delegado por ele). */
const s: Record<string, string> = {};

const OUTSIDERS = ['admin', 'ceo', 'dir', 'dir2', 'gest2', 'gest3', 'func2', 'func3'];
/** Quem enxerga tarefas não privadas do gestor pelo acesso de auditoria (log). */
const AUDITORS = ['admin', 'ceo', 'dir'];

/** Fotografia das tabelas de dados: qualquer mudança aparece como diferença. */
async function snapshot() {
  const tables = ['boards', 'lists', 'cards', 'checklist_items', 'comments', 'delegations', 'card_events', 'users', 'manager_changes', 'saved_filters'];
  const out: Record<string, string> = {};
  for (const t of tables) {
    const r = await ctx.pool.query(`SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM ${t} x`);
    out[t] = r.rows[0].h;
  }
  return out;
}

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
  // Tarefa comum, com checklist e comentário.
  const own = await newTask(ctx, 'gest', 'Tarefa comum do gestor', day(4));
  s.own = own.id; s.ownCode = own.code; s.list = own.listId; s.list2 = own.lists[1].id;
  s.item = (await call('gest', 'POST', `/api/cards/${own.id}/checklist`, { text: 'Item' })).body.id;
  await call('gest', 'POST', `/api/cards/${own.id}/comments`, { body: 'Comentário' });
  s.board = (await call('gest', 'GET', '/api/boards')).body[0].id;
  // Tarefa privada.
  const priv = await newTask(ctx, 'gest', 'Segredo do gestor');
  await call('gest', 'PATCH', `/api/cards/${priv.id}`, { isPrivate: true, description: 'confidencial' });
  s.priv = priv.id; s.privCode = priv.code;
  // Tarefa concluída (para testar desfazer/arquivar por outra pessoa).
  const done = await newTask(ctx, 'gest', 'Concluída do gestor');
  await call('gest', 'POST', `/api/cards/${done.id}/complete`);
  s.done = done.id;
  // Delegação em andamento: gest → func.
  const parent = await newTask(ctx, 'gest', 'Delegada ao funcionário');
  const d = await delegateTask(ctx, 'gest', parent.id, 'func');
  await acceptTask(ctx, 'func', d.cardId);
  s.parent = parent.id; s.child = d.cardId; s.deleg = d.delegationId;
  // Delegação aguardando ciente e delegação devolvida.
  const p2 = await newTask(ctx, 'gest', 'Aguardando ciente');
  const d2 = await delegateTask(ctx, 'gest', p2.id, 'func2');
  await acceptTask(ctx, 'func2', d2.cardId);
  await call('func2', 'POST', `/api/cards/${d2.cardId}/complete`);
  s.awaiting = d2.delegationId; s.awaitingCard = d2.cardId;
  const p3 = await newTask(ctx, 'gest', 'Devolvida');
  const d3 = await delegateTask(ctx, 'gest', p3.id, 'func');
  await call('func', 'POST', `/api/cards/${d3.cardId}/decline`, { reason: 'Não consigo' });
  s.declined = d3.delegationId;
  // Uma tarefa ainda na caixa de entrada de func2.
  const p4 = await newTask(ctx, 'gest', 'Na caixa de entrada');
  const d4 = await delegateTask(ctx, 'gest', p4.id, 'func2');
  s.inboxCard = d4.cardId;
  // Filtro salvo da tabela (item 36).
  s.filter = (await call('gest', 'POST', '/api/filters', { name: 'Do gestor', filter: { all: [{ field: 'status', op: 'eq', value: 'open' }] } })).body.id;
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

/** Todas as ações possíveis sobre o que pertence ao gestor. `who` entra para escolher destinos "dele". */
async function attemptsAgainstGest(who: string): Promise<Attempt[]> {
  const myList = ctx.users[who] && who !== 'admin' ? await firstListOf(ctx, who).catch(() => s.list2) : s.list2;
  const someone = ctx.users.func3.id;
  const card = (id: string): Attempt[] => [
    { method: 'PATCH', url: `/api/cards/${id}`, body: { title: 'invadido' }, route: 'PATCH /api/cards/:id' },
    { method: 'PATCH', url: `/api/cards/${id}`, body: { isPrivate: false }, route: 'PATCH /api/cards/:id' },
    { method: 'PATCH', url: `/api/cards/${id}`, body: { dueDate: day(30) }, route: 'PATCH /api/cards/:id' },
    { method: 'POST', url: `/api/cards/${id}/move`, body: { listId: myList }, route: 'POST /api/cards/:id/move' },
    { method: 'POST', url: `/api/cards/${id}/move`, body: { listId: s.list2 }, route: 'POST /api/cards/:id/move' },
    { method: 'POST', url: `/api/cards/${id}/complete`, route: 'POST /api/cards/:id/complete' },
    { method: 'POST', url: `/api/cards/${id}/uncomplete`, route: 'POST /api/cards/:id/uncomplete' },
    { method: 'POST', url: `/api/cards/${id}/archive`, route: 'POST /api/cards/:id/archive' },
    { method: 'POST', url: `/api/cards/${id}/unarchive`, route: 'POST /api/cards/:id/unarchive' },
    { method: 'POST', url: `/api/cards/${id}/checklist`, body: { text: 'x' }, route: 'POST /api/cards/:id/checklist' },
    { method: 'PATCH', url: `/api/cards/${id}/checklist/${s.item}`, body: { done: true }, route: 'PATCH /api/cards/:id/checklist/:itemId' },
    { method: 'DELETE', url: `/api/cards/${id}/checklist/${s.item}`, route: 'DELETE /api/cards/:id/checklist/:itemId' },
    { method: 'POST', url: `/api/cards/${id}/delegate`, body: { toUserId: someone }, route: 'POST /api/cards/:id/delegate' },
    { method: 'POST', url: `/api/cards/${id}/accept`, body: { listId: myList }, route: 'POST /api/cards/:id/accept' },
    { method: 'POST', url: `/api/cards/${id}/decline`, body: { reason: 'não quero' }, route: 'POST /api/cards/:id/decline' },
    { method: 'POST', url: `/api/cards/${id}/transfer`, body: { toUserId: someone }, route: 'POST /api/cards/:id/transfer' },
    { method: 'GET', url: `/api/cards/${id}/transfer-targets`, route: 'GET /api/cards/:id/transfer-targets' },
  ];
  const deleg = (id: string): Attempt[] => [
    { method: 'POST', url: `/api/delegations/${id}/ack`, route: 'POST /api/delegations/:id/ack' },
    { method: 'POST', url: `/api/delegations/${id}/reopen`, body: { comment: 'refazer tudo' }, route: 'POST /api/delegations/:id/reopen' },
    { method: 'POST', url: `/api/delegations/${id}/cancel`, route: 'POST /api/delegations/:id/cancel' },
    { method: 'POST', url: `/api/delegations/${id}/redelegate`, body: { toUserId: someone }, route: 'POST /api/delegations/:id/redelegate' },
  ];
  return [
    { method: 'GET', url: `/api/boards/${s.board}`, route: 'GET /api/boards/:id' },
    { method: 'PATCH', url: `/api/boards/${s.board}`, body: { name: 'invadido' }, route: 'PATCH /api/boards/:id' },
    { method: 'PATCH', url: `/api/boards/${s.board}`, body: { color: 'roxo' }, route: 'PATCH /api/boards/:id' },
    { method: 'PATCH', url: `/api/boards/${s.board}`, body: { position: -5 }, route: 'PATCH /api/boards/:id' },
    { method: 'POST', url: `/api/boards/${s.board}/lists`, body: { name: 'invasão' }, route: 'POST /api/boards/:id/lists' },
    { method: 'PATCH', url: `/api/lists/${s.list}`, body: { name: 'invadida', position: 99 }, route: 'PATCH /api/lists/:id' },
    { method: 'POST', url: `/api/lists/${s.list}/sort`, body: { by: 'title' }, route: 'POST /api/lists/:id/sort' },
    { method: 'POST', url: `/api/lists/${s.list}/archive-done`, route: 'POST /api/lists/:id/archive-done' },
    { method: 'POST', url: `/api/lists/${s.list2}/archive`, route: 'POST /api/lists/:id/archive' },
    { method: 'POST', url: '/api/cards', body: { listId: s.list, title: 'enfiada no quadro alheio' }, route: 'POST /api/cards' },
    { method: 'POST', url: '/api/cards/batch', body: { listId: s.list, titles: ['enfiada 1', 'enfiada 2'] }, route: 'POST /api/cards/batch' },
    { method: 'POST', url: '/api/cards/undo-create', body: { ids: [s.own] }, route: 'POST /api/cards/undo-create' },
    { method: 'POST', url: '/api/cards/undo-create', body: { ids: [s.priv, s.done, s.parent] }, route: 'POST /api/cards/undo-create' },
    { method: 'POST', url: `/api/cards/${s.own}/comments`, body: { body: 'intrometido' }, route: 'POST /api/cards/:id/comments' },
    { method: 'POST', url: `/api/cards/${s.priv}/comments`, body: { body: 'intrometido' }, route: 'POST /api/cards/:id/comments' },
    { method: 'PATCH', url: `/api/filters/${s.filter}`, body: { name: 'invasão' }, route: 'PATCH /api/filters/:id' },
    { method: 'PATCH', url: `/api/filters/${s.filter}`, body: { filter: { all: [] } }, route: 'PATCH /api/filters/:id' },
    { method: 'DELETE', url: `/api/filters/${s.filter}`, route: 'DELETE /api/filters/:id' },
    ...card(s.own), ...card(s.priv), ...card(s.done), ...card(s.parent), ...card(s.inboxCard),
    ...deleg(s.deleg), ...deleg(s.awaiting), ...deleg(s.declined),
  ];
}

describe('permissões em massa (frente 2)', () => {
  it('ninguém consegue alterar nada do gestor: todas as tentativas são recusadas e o banco não muda', async () => {
    const before = await snapshot();
    const accepted: string[] = [];
    let total = 0;
    for (const who of OUTSIDERS) {
      for (const a of await attemptsAgainstGest(who)) {
        // func2 é o dono legítimo da tarefa na caixa de entrada: não é "intruso" dela.
        if (who === 'func2' && a.url.includes(s.inboxCard)) continue;
        total++;
        const r = await call(who, a.method, a.url, a.body);
        if (a.method === 'GET') {
          if (r.status < 400) accepted.push(`${who} ${a.method} ${a.url} → ${r.status}`);
        } else if (r.status < 400 || r.status >= 500) {
          accepted.push(`${who} ${a.method} ${a.url} ${JSON.stringify(a.body ?? '')} → ${r.status}`);
        }
      }
    }
    expect(accepted, 'ações que deveriam ter sido recusadas').toEqual([]);
    expect(total).toBeGreaterThan(500);
    expect(await snapshot()).toEqual(before);
  });

  it('o subordinado que recebeu a delegação só mexe no próprio cartão, nunca no de origem nem nas delegações', async () => {
    const before = await snapshot();
    const tries: Attempt[] = [
      { method: 'PATCH', url: `/api/cards/${s.parent}`, body: { title: 'x' }, route: '' },
      { method: 'POST', url: `/api/cards/${s.parent}/complete`, route: '' },
      { method: 'POST', url: `/api/delegations/${s.deleg}/ack`, route: '' },
      { method: 'POST', url: `/api/delegations/${s.deleg}/cancel`, route: '' },
      { method: 'POST', url: `/api/delegations/${s.awaiting}/ack`, route: '' },
      { method: 'POST', url: `/api/cards/${s.child}/transfer`, body: { toUserId: ctx.users.gest.id }, route: '' }, // o delegador não é destino (RN-32)
      { method: 'POST', url: `/api/cards/${s.child}/move`, body: { listId: s.list }, route: '' }, // fase do gestor
      { method: 'PATCH', url: `/api/cards/${s.child}`, body: { isPrivate: true }, route: '' }, // RN-08
    ];
    for (const t of tries) {
      const r = await call('func', t.method, t.url, t.body);
      expect(r.status, `${t.method} ${t.url}`).toBeGreaterThanOrEqual(400);
      expect(r.status, `${t.method} ${t.url}`).toBeLessThan(500);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('quem pode só olhar (auditoria) vê; os demais recebem 404, sem revelar que a tarefa existe', async () => {
    for (const who of OUTSIDERS) {
      const r = await call(who, 'GET', `/api/cards/${s.own}`);
      if (AUDITORS.includes(who)) {
        expect(r.status, who).toBe(200);
        expect(r.body.role, who).toBe('auditor');
        expect(r.body.board, who).toBeNull(); // a estrutura do quadro alheio não vaza
      } else {
        expect(r.status, who).toBe(404);
      }
      const byCode = await call(who, 'GET', `/api/cards/by-code/${s.ownCode}`);
      expect(byCode.status, who).toBe(AUDITORS.includes(who) ? 200 : 404);
      const log = await call(who, 'GET', `/api/cards/${s.own}/events`);
      expect(log.status, who).toBe(AUDITORS.includes(who) ? 200 : 404);
    }
  });

  it('tarefa privada não aparece para ninguém: nem auditoria, busca, delegadas, painel ou contadores', async () => {
    for (const who of [...OUTSIDERS, 'func']) {
      expect((await call(who, 'GET', `/api/cards/${s.priv}`)).status, who).toBe(404);
      expect((await call(who, 'GET', `/api/cards/by-code/${s.privCode}`)).status, who).toBe(404);
      expect((await call(who, 'GET', `/api/cards/${s.priv}/events`)).status, who).toBeGreaterThanOrEqual(403);
      const byText = (await call(who, 'GET', `/api/search?q=${encodeURIComponent('Segredo')}`)).body;
      expect(byText.results ?? [], who).toHaveLength(0);
      const byDesc = (await call(who, 'GET', `/api/search?q=confidencial`)).body;
      expect(byDesc.results ?? [], who).toHaveLength(0);
      const byCode = (await call(who, 'GET', `/api/search?q=${s.privCode}`)).body;
      expect(byCode.byCode, who).toBeNull();
      if (who !== 'admin') {
        const ov = JSON.stringify((await call(who, 'GET', '/api/delegations')).body);
        expect(ov.includes('Segredo'), who).toBe(false);
        const dash = JSON.stringify((await call(who, 'GET', '/api/dashboard')).body);
        expect(dash.includes('Segredo'), who).toBe(false);
      }
      // Arquivadas e tabela (itens 35 e 36): só as tarefas da própria pessoa, com ou sem filtro.
      expect(JSON.stringify((await call(who, 'GET', '/api/archived?q=Segredo')).body).includes('Segredo'), who).toBe(false);
      const f = encodeURIComponent(JSON.stringify({ any: [{ field: 'title', op: 'contains', value: 'Segredo' }, { field: 'archived', op: 'eq', value: true }] }));
      expect(JSON.stringify((await call(who, 'GET', `/api/table?filter=${f}`)).body).includes('Segredo'), who).toBe(false);
      expect(JSON.stringify((await call(who, 'GET', '/api/filters')).body).includes('Do gestor'), who).toBe(false);
    }
    // O contador "próprias" do diretor não conta a privada (gest tem 2 abertas próprias não privadas: comum e as de origem).
    const ov = (await call('dir', 'GET', '/api/delegations')).body;
    const g = ov.groups.find((x: any) => x.person.id === ctx.users.gest.id);
    const sql = await ctx.pool.query(
      `SELECT count(*)::int AS n FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
        WHERE c.owner_id = $1 AND d.id IS NULL AND c.archived_at IS NULL AND c.completed_at IS NULL AND NOT c.is_private`,
      [ctx.users.gest.id],
    );
    expect(g.counts.own).toBe(sql.rows[0].n);
  });

  it('administração: só administrador entra; os demais recebem 403 em todas as rotas', async () => {
    const before = await snapshot();
    const target = ctx.users.func3.id;
    const routes: Attempt[] = [
      { method: 'GET', url: '/api/admin/users', route: 'GET /api/admin/users' },
      { method: 'POST', url: '/api/admin/users', body: { name: 'Novo', email: 'novo@teste.com', level: 3, managerId: ctx.users.gest.id }, route: 'POST /api/admin/users' },
      { method: 'PATCH', url: `/api/admin/users/${target}`, body: { isAdmin: true }, route: 'PATCH /api/admin/users/:id' },
      { method: 'POST', url: `/api/admin/users/${target}/transfer-management`, body: { managerId: ctx.users.gest.id }, route: 'POST /api/admin/users/:id/transfer-management' },
      { method: 'POST', url: `/api/admin/users/${target}/active`, body: { active: false }, route: 'POST /api/admin/users/:id/active' },
      { method: 'POST', url: `/api/admin/users/${target}/invite`, route: 'POST /api/admin/users/:id/invite' },
    ];
    for (const who of ['ceo', 'dir', 'gest', 'func']) {
      for (const r of routes) expect((await call(who, r.method, r.url, r.body)).status, `${who} ${r.method} ${r.url}`).toBe(403);
    }
    expect(await snapshot()).toEqual(before);
  });

  it('sem login, tudo responde 401; sem o cabeçalho de segurança, toda alteração responde 403', async () => {
    const before = await snapshot();
    const all = [...(await attemptsAgainstGest('gest2')), { method: 'GET' as Method, url: '/api/me', route: '' }, { method: 'GET' as Method, url: '/api/inbox', route: '' }];
    for (const a of all) {
      const anon = await ctx.app.inject({ method: a.method, url: a.url, headers: { 'x-synctasks': '1' }, payload: a.body as any });
      expect(anon.statusCode, `anônimo ${a.method} ${a.url}`).toBe(401);
      if (a.method !== 'GET') {
        // Até o próprio dono, sem o cabeçalho, é recusado (proteção contra sites maliciosos).
        const csrf = await ctx.app.inject({ method: a.method, url: a.url, headers: { cookie: ctx.users.gest.cookie }, payload: a.body as any });
        expect(csrf.statusCode, `sem cabeçalho ${a.method} ${a.url}`).toBe(403);
      }
    }
    const fake = await ctx.app.inject({ method: 'GET', url: '/api/me', headers: { cookie: 'synctasks_sid=inventado' } });
    expect(fake.statusCode).toBe(401);
    expect(await snapshot()).toEqual(before);
  });

  it('ninguém usa a própria tarefa para mexer em item, fase ou pessoa de outro', async () => {
    const mine = await newTask(ctx, 'gest2', 'Minha tarefa');
    const after = await snapshot();
    // item do checklist de outra tarefa, pela rota da minha
    expect((await call('gest2', 'PATCH', `/api/cards/${mine.id}/checklist/${s.item}`, { done: true })).status).toBe(404);
    expect((await call('gest2', 'DELETE', `/api/cards/${mine.id}/checklist/${s.item}`)).status).toBe(404);
    // mover minha tarefa para a fase de outra pessoa
    expect((await call('gest2', 'POST', `/api/cards/${mine.id}/move`, { listId: s.list })).status).toBe(404);
    // delegar para subordinado de outro / transferir para fora dos destinos
    expect((await call('gest2', 'POST', `/api/cards/${mine.id}/delegate`, { toUserId: ctx.users.func.id })).status).toBe(403);
    expect((await call('gest2', 'POST', `/api/cards/${mine.id}/transfer`, { toUserId: ctx.users.func.id })).status).toBe(403);
    expect((await call('gest2', 'POST', `/api/cards/${mine.id}/transfer`, { toUserId: ctx.users.admin.id })).status).toBe(403);
    expect((await call('gest2', 'POST', `/api/cards/${mine.id}/transfer`, { toUserId: ctx.users.gest3.id })).status).toBe(403); // outro diretor
    expect(await snapshot()).toEqual(after);
  });

  it('todas as rotas da API estão cobertas por este teste (se alguém criar uma rota nova, este teste avisa)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.resolve(here, '../src/app.ts'), 'utf8');
    const routes = [...src.matchAll(/app\.(get|post|patch|delete)\('([^']+)'/g)].map((m) => `${m[1].toUpperCase()} ${m[2]}`);
    const covered = new Set([
      // cobertas pela matriz acima
      'GET /api/boards/:id', 'PATCH /api/boards/:id', 'POST /api/boards/:id/lists', 'PATCH /api/lists/:id', 'POST /api/lists/:id/sort',
      'POST /api/lists/:id/archive-done', 'POST /api/lists/:id/archive', 'POST /api/cards', 'POST /api/cards/batch', 'POST /api/cards/undo-create', 'GET /api/cards/:id', 'GET /api/cards/by-code/:code',
      'PATCH /api/cards/:id', 'POST /api/cards/:id/move', 'POST /api/cards/:id/complete', 'POST /api/cards/:id/uncomplete',
      'POST /api/cards/:id/archive', 'POST /api/cards/:id/unarchive', 'POST /api/cards/:id/checklist', 'PATCH /api/cards/:id/checklist/:itemId',
      'DELETE /api/cards/:id/checklist/:itemId', 'POST /api/cards/:id/comments', 'GET /api/cards/:id/events', 'POST /api/cards/:id/delegate',
      'POST /api/cards/:id/accept', 'POST /api/cards/:id/decline', 'GET /api/cards/:id/transfer-targets', 'POST /api/cards/:id/transfer',
      'POST /api/delegations/:id/ack', 'POST /api/delegations/:id/reopen', 'POST /api/delegations/:id/cancel', 'POST /api/delegations/:id/redelegate',
      'GET /api/admin/users', 'POST /api/admin/users', 'PATCH /api/admin/users/:id', 'POST /api/admin/users/:id/transfer-management',
      'POST /api/admin/users/:id/active', 'POST /api/admin/users/:id/invite', 'PATCH /api/filters/:id', 'DELETE /api/filters/:id',
      // só leem ou alteram os dados da própria pessoa (não recebem identificador de outra)
      'GET /api/me', 'PATCH /api/me/prefs', 'GET /api/boards', 'POST /api/boards', 'GET /api/inbox', 'GET /api/delegations', 'GET /api/dashboard',
      'GET /api/search', 'GET /api/notifications', 'POST /api/notifications/read', 'POST /api/capture', 'POST /api/import/trello',
      'GET /api/archived', 'GET /api/table', 'GET /api/table/options', 'GET /api/filters', 'POST /api/filters',
      // públicas por natureza
      'POST /api/auth/login', 'POST /api/auth/logout', 'POST /api/auth/password/forgot', 'POST /api/auth/password/set', 'GET /api/health', 'GET /compartilhar',
    ]);
    const missing = routes.filter((r) => !covered.has(r));
    expect(missing, 'rotas novas sem teste de permissão: inclua-as em permissions.test.ts').toEqual([]);
  });
});
