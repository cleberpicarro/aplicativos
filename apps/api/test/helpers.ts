import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/lib/db.js';
import { migrate } from '../src/lib/migrate.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/passwords.js';
import { createUser } from '../src/services/admin.js';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://nerus:nerus@localhost:5432/nerus_test';
export const PASSWORD = 'senha-segura-1';

export interface Ctx {
  pool: Pool;
  app: FastifyInstance;
  users: Record<string, { id: string; email: string; cookie: string }>;
}

/** Banco limpo + hierarquia: ceo > dir > (gest, gest2) ; gest > (func, func2) ; gest2 > func3 ; admin fora da árvore. */
export async function setup(): Promise<Ctx> {
  const pool = createPool(TEST_DB);
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  const app = await buildApp({ pool });
  const hash = await hashPassword(PASSWORD);
  const spec: [string, number | null, string | null, boolean?][] = [
    ['admin', null, null, true],
    ['ceo', 0, null],
    ['dir', 1, 'ceo'],
    ['dir2', 1, 'ceo'],
    ['gest', 2, 'dir'],
    ['gest2', 2, 'dir'],
    ['gest3', 2, 'dir2'],
    ['func', 3, 'gest'],
    ['func2', 3, 'gest'],
    ['func3', 3, 'gest2'],
  ];
  const users: Ctx['users'] = {};
  for (const [key, level, manager, isAdmin] of spec) {
    const client = await pool.connect();
    try {
      const { user } = await createUser(client, {
        name: `${key[0].toUpperCase()}${key.slice(1)} Teste`,
        email: `${key}@teste.com`,
        level,
        managerId: manager ? users[manager].id : null,
        isAdmin,
      });
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
      users[key] = { id: user.id, email: user.email, cookie: '' };
    } finally {
      client.release();
    }
  }
  for (const key of Object.keys(users)) users[key].cookie = await login(app, users[key].email, PASSWORD);
  return { pool, app, users };
}

export async function login(app: FastifyInstance, email: string, password: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-synctasks': '1' }, payload: { email, password } });
  if (r.statusCode !== 200) throw new Error(`login falhou: ${r.body}`);
  const c = r.cookies.find((x) => x.name === 'synctasks_sid')!;
  return `synctasks_sid=${c.value}`;
}

export function api(ctx: Ctx) {
  return async (who: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const r = await ctx.app.inject({
      method,
      url,
      headers: { cookie: ctx.users[who].cookie, 'x-synctasks': '1' },
      payload: payload as any,
    });
    let body: any = null;
    try {
      body = r.json();
    } catch {
      body = r.body;
    }
    return { status: r.statusCode, body };
  };
}

/** Cria uma tarefa na primeira fase do primeiro quadro do usuário. */
export async function newTask(ctx: Ctx, who: string, title: string, dueDate?: string) {
  const call = api(ctx);
  const boards = (await call(who, 'GET', '/api/boards')).body;
  const board = (await call(who, 'GET', `/api/boards/${boards[0].id}`)).body;
  const c = (await call(who, 'POST', '/api/cards', { listId: board.lists[0].id, title })).body;
  if (dueDate) await call(who, 'PATCH', `/api/cards/${c.id}`, { dueDate });
  return { id: c.id as string, code: c.code as string, num: c.num as number, listId: board.lists[0].id as string, lists: board.lists as { id: string; name: string }[] };
}

export async function firstListOf(ctx: Ctx, who: string) {
  const call = api(ctx);
  const boards = (await call(who, 'GET', '/api/boards')).body;
  const board = (await call(who, 'GET', `/api/boards/${boards[0].id}`)).body;
  return board.lists[0].id as string;
}

/** Delega e retorna o cartão criado para o subordinado. */
export async function delegateTask(ctx: Ctx, from: string, cardId: string, to: string, extra: object = {}) {
  const r = await api(ctx)(from, 'POST', `/api/cards/${cardId}/delegate`, { toUserId: ctx.users[to].id, ...extra });
  if (r.status !== 200) throw new Error(`delegar falhou: ${JSON.stringify(r.body)}`);
  return r.body as { cardId: string; code: string; num: number; delegationId: string };
}

export async function acceptTask(ctx: Ctx, who: string, cardId: string) {
  const r = await api(ctx)(who, 'POST', `/api/cards/${cardId}/accept`, { listId: await firstListOf(ctx, who) });
  if (r.status !== 200) throw new Error(`aceitar falhou: ${JSON.stringify(r.body)}`);
}

export function day(n: number) {
  // Mesmo "hoje" do app: o dia em Brasília, e não em UTC (à noite, UTC já está no dia seguinte).
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
