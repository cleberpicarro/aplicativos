/**
 * Item 65: conector para assistentes de IA (OAuth + MCP).
 * O assistente se cadastra, a pessoa clica em "Permitir", o assistente troca o código pela chave
 * e usa as ferramentas sempre em nome dela, com as regras do app.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, newTask, delegateTask, day, type Ctx } from './helpers.js';

let ctx: Ctx;
let call: ReturnType<typeof api>;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

beforeAll(async () => {
  ctx = await setup();
  call = api(ctx);
});
afterAll(async () => {
  await ctx.app.close();
  await ctx.pool.end();
});

async function register(redirect = REDIRECT) {
  const r = await ctx.app.inject({ method: 'POST', url: '/oauth/register', payload: { client_name: 'Claude', redirect_uris: [redirect] } });
  expect(r.statusCode).toBe(201);
  return r.json().client_id as string;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function form(body: Record<string, string>) {
  return ctx.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(body).toString(),
  });
}

/** O caminho inteiro: cadastro, Permitir e troca do código. */
async function connect(who: string) {
  const clientId = await register();
  const { verifier, challenge } = pkce();
  const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz' };
  const d = await call(who, 'POST', '/api/oauth/decide', { ...params, allow: true });
  expect(d.status).toBe(200);
  const back = new URL(d.body.redirect);
  expect(back.origin + back.pathname).toBe(REDIRECT);
  expect(back.searchParams.get('state')).toBe('xyz');
  const t = await form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
  expect(t.statusCode).toBe(200);
  return { ...t.json(), clientId } as { clientId: string; access_token: string; refresh_token: string; expires_in: number };
}

async function rpc(token: string, method: string, params?: unknown, id: number | null = 1) {
  const r = await ctx.app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream' },
    payload: { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) },
  });
  return { status: r.statusCode, body: r.body ? r.json() : null, headers: r.headers };
}
const tool = async (token: string, name: string, args: unknown = {}) => (await rpc(token, 'tools/call', { name, arguments: args })).body.result;

describe('conector para assistentes (item 65)', () => {
  it('publica os endereços de descoberta do OAuth e pede a chave no /mcp', async () => {
    const pr = await ctx.app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource/mcp' });
    expect(pr.json().resource).toMatch(/\/mcp$/);
    const as = (await ctx.app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json();
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.registration_endpoint).toMatch(/\/oauth\/register$/);
    const anon = await rpc('', 'tools/list');
    expect(anon.status).toBe(401);
    expect(anon.headers['www-authenticate']).toContain('resource_metadata=');
    const fake = await rpc('sta_inventada', 'tools/list');
    expect(fake.status).toBe(401);
  });

  it('o cadastro só aceita endereço de volta https ou do próprio computador', async () => {
    for (const bad of ['http://site-qualquer.com/cb', 'javascript:alert(1)', 'https://x.com/cb#frag']) {
      const r = await ctx.app.inject({ method: 'POST', url: '/oauth/register', payload: { redirect_uris: [bad] } });
      expect(r.statusCode, bad).toBe(400);
    }
    await register('http://localhost:33418/callback');
  });

  it('/oauth/authorize leva à tela Permitir do app com os mesmos parâmetros', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/oauth/authorize?client_id=abc&state=1' });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe('/#/conectar?client_id=abc&state=1');
  });

  it('a tela Permitir mostra quem pede e recusa cliente ou endereço de volta que não conferem', async () => {
    const clientId = await register();
    const ok = await call('gest', 'GET', `/api/oauth/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}&response_type=code&code_challenge=x&code_challenge_method=S256`);
    expect(ok.body).toEqual({ name: 'Claude', host: 'claude.ai', problem: null });
    const wrong = await call('gest', 'GET', `/api/oauth/request?client_id=${clientId}&redirect_uri=${encodeURIComponent('https://outro.com/cb')}`);
    expect(wrong.status).toBe(403);
    const unknown = await call('gest', 'GET', `/api/oauth/request?client_id=nao-existe&redirect_uri=${encodeURIComponent(REDIRECT)}`);
    expect(unknown.status).toBe(404);
    const anon = await ctx.app.inject({ method: 'GET', url: `/api/oauth/request?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT)}` });
    expect(anon.statusCode).toBe(401);
  });

  it('"Agora não" volta ao assistente com access_denied e não cria código', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const d = await call('gest', 'POST', '/api/oauth/decide', { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's', allow: false });
    const back = new URL(d.body.redirect);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('o código vale uma vez só e exige o PKCE certo', async () => {
    const clientId = await register();
    const { verifier, challenge } = pkce();
    const d = await call('gest', 'POST', '/api/oauth/decide', { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', allow: true });
    const code = new URL(d.body.redirect).searchParams.get('code')!;
    const wrong = await form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: 'errado' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error).toBe('invalid_grant');
    const first = await form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(first.statusCode).toBe(200);
    const again = await form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier });
    expect(again.statusCode).toBe(400);
  });

  it('administrador fora da hierarquia não conecta (não tem quadros)', async () => {
    const clientId = await register();
    const { challenge } = pkce();
    const d = await call('admin', 'POST', '/api/oauth/decide', { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', allow: true });
    expect(d.status).toBe(403);
  });

  it('o assistente lista quadros, cria tarefas na caixa de entrada e no quadro, e vê as tarefas', async () => {
    const { access_token: t } = await connect('func');
    const init = await rpc(t, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } });
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect(init.body.result.capabilities.tools).toBeTruthy();
    expect((await rpc(t, 'notifications/initialized', undefined, null)).status).toBe(202);
    const names = (await rpc(t, 'tools/list')).body.result.tools.map((x: any) => x.name);
    expect(names).toEqual(['listar_quadros', 'criar_tarefas', 'ver_tarefas']);

    const boards = (await call('func', 'GET', '/api/boards')).body;
    const boardName = boards[0].name as string;
    const listed = await tool(t, 'listar_quadros');
    expect(listed.content[0].text).toContain(boardName);

    const created = await tool(t, 'criar_tarefas', {
      tarefas: [
        { titulo: 'Ligar para o Marcelo', prazo: day(2) },
        { titulo: 'Mandar proposta', descricao: 'Para a Alfa', quadro: boardName.toUpperCase(), fase: 'fazendo' },
      ],
    });
    expect(created.isError).toBeFalsy();
    expect(created.content[0].text).toContain('Criadas 2 tarefas');

    const inbox = (await call('func', 'GET', '/api/inbox')).body;
    const fromInbox = inbox.find((c: any) => c.title === 'Ligar para o Marcelo');
    expect(fromInbox.source).toBe('assistente');
    expect(fromInbox.dueDate).toBe(day(2));
    const board = (await call('func', 'GET', `/api/boards/${boards[0].id}`)).body;
    const inBoard = board.cards.find((c: any) => c.title === 'Mandar proposta');
    expect(inBoard.listId).toBe(board.lists.find((l: any) => l.name === 'Fazendo').id);
    expect(inBoard.description).toBe('Para a Alfa');
    expect(inBoard.source).toBe('assistente');
    const r = await ctx.pool.query(`SELECT created_by FROM cards WHERE id = $1`, [inBoard.id]);
    expect(r.rows[0].created_by).toBe(ctx.users.func.id);

    const open = (await tool(t, 'ver_tarefas', { situacao: 'abertas' })).content[0].text;
    expect(open).toContain('Mandar proposta');
    const box = (await tool(t, 'ver_tarefas', { situacao: 'caixa_de_entrada' })).content[0].text;
    expect(box).toContain('Ligar para o Marcelo');
    expect(box).not.toContain('Mandar proposta');
  });

  it('quadro inexistente ou título vazio: nada é criado e o assistente recebe a explicação', async () => {
    const { access_token: t } = await connect('func2');
    const before = (await ctx.pool.query('SELECT count(*)::int AS n FROM cards')).rows[0].n;
    const bad = await tool(t, 'criar_tarefas', { tarefas: [{ titulo: 'Ok' }, { titulo: 'Outra', quadro: 'Quadro que não existe' }] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('não encontrado');
    const empty = await tool(t, 'criar_tarefas', { tarefas: [{ titulo: '  ' }] });
    expect(empty.isError).toBe(true);
    const badDate = await tool(t, 'criar_tarefas', { tarefas: [{ titulo: 'X', prazo: '2026-02-30' }] });
    expect(badDate.isError).toBe(true);
    expect((await ctx.pool.query('SELECT count(*)::int AS n FROM cards')).rows[0].n).toBe(before);
    expect((await rpc(t, 'tools/call', { name: 'apagar_tudo', arguments: {} })).body.error.code).toBe(-32602);
    expect((await rpc(t, 'resources/list')).body.error.code).toBe(-32601);
  });

  it('o assistente só vê as tarefas da própria pessoa', async () => {
    const own = await newTask(ctx, 'gest', 'Segredo do gestor para o assistente');
    await delegateTask(ctx, 'gest', own.id, 'func');
    const { access_token: t } = await connect('gest2');
    const text = (await tool(t, 'ver_tarefas', {})).content[0].text;
    expect(text).not.toContain('Segredo do gestor');
    const { access_token: tf } = await connect('func');
    // O funcionário vê a cópia que recebeu na caixa de entrada, mas nunca a tarefa do gestor.
    const box = (await tool(tf, 'ver_tarefas', { situacao: 'caixa_de_entrada' })).content[0].text;
    expect(box).toContain('Segredo do gestor');
    expect(box).toContain('delegada por Gest Teste');
  });

  it('renovar troca as duas chaves; Desligar em Meus dados corta na hora; só a dona desliga', async () => {
    const c = await connect('gest3');
    const ren = await form({ grant_type: 'refresh_token', refresh_token: c.refresh_token, client_id: c.clientId });
    expect(ren.statusCode).toBe(200);
    const fresh = ren.json();
    expect(fresh.access_token).not.toBe(c.access_token);
    expect((await rpc(c.access_token, 'ping')).status).toBe(401);
    expect((await form({ grant_type: 'refresh_token', refresh_token: c.refresh_token })).statusCode).toBe(400);
    expect((await rpc(fresh.access_token, 'ping')).body.result).toEqual({});

    const list = (await call('gest3', 'GET', '/api/me/assistants')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Claude', host: 'claude.ai' });
    expect((await call('gest2', 'GET', '/api/me/assistants')).body.some((g: any) => g.id === list[0].id)).toBe(false);
    expect((await call('gest2', 'DELETE', `/api/me/assistants/${list[0].id}`)).status).toBe(404);
    expect((await rpc(fresh.access_token, 'ping')).status).toBe(200);

    expect((await call('gest3', 'DELETE', `/api/me/assistants/${list[0].id}`)).status).toBe(200);
    expect((await rpc(fresh.access_token, 'ping')).status).toBe(401);
    expect((await form({ grant_type: 'refresh_token', refresh_token: fresh.refresh_token })).statusCode).toBe(400);
    expect((await call('gest3', 'GET', '/api/me/assistants')).body).toHaveLength(0);
  });

  it('pessoa desativada perde o acesso do assistente', async () => {
    const c = await connect('func3');
    expect((await rpc(c.access_token, 'ping')).status).toBe(200);
    await ctx.pool.query('UPDATE users SET active = false WHERE id = $1', [ctx.users.func3.id]);
    expect((await rpc(c.access_token, 'ping')).status).toBe(401);
    expect((await form({ grant_type: 'refresh_token', refresh_token: c.refresh_token })).statusCode).toBe(400);
    await ctx.pool.query('UPDATE users SET active = true WHERE id = $1', [ctx.users.func3.id]);
  });
});
