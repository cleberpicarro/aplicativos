import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { z, ZodError } from 'zod';
import { config } from './config.js';
import { tx, type Pool } from './lib/db.js';
import { HttpError, forbidden, unauthorized, notFound } from './lib/errors.js';
import type { Actor } from './services/actors.js';
import * as auth from './services/auth.js';
import * as boards from './services/boards.js';
import * as tasks from './services/tasks.js';
import * as deleg from './services/delegation.js';
import * as admin from './services/admin.js';
import * as misc from './services/misc.js';
import { importTrello, trelloImportSchema } from './services/importer.js';
import { captureWeb } from './services/capture.js';
import { dashboard } from './services/dashboard.js';
import { cardDetail, cardIdByCode, loadCard } from './services/cards.js';
import { canSeeLog } from './services/actors.js';
import { isoDate } from './lib/dates.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const SESSION_COOKIE = 'synctasks_sid';
const uuid = z.string().uuid();
const date = isoDate.nullable();

export interface AppOptions {
  pool: Pool;
  logger?: boolean;
  serveWeb?: boolean;
}

export async function buildApp({ pool, logger = false, serveWeb = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true });
  await app.register(cookie);
  app.decorateRequest('actor', null);

  /* Proteção CSRF: toda requisição que altera dados precisa do cabeçalho X-SyncTasks (navegadores não o enviam entre sites sem CORS). */
  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-synctasks'] !== '1') {
      throw forbidden('Requisição recusada.');
    }
  });
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/')) req.actor = await auth.actorFromSession(pool, req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      return reply.status(422).send({ error: `Dado inválido${issue?.path.length ? ` em ${issue.path.join('.')}` : ''}.` });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'Erro inesperado. Tente novamente.' });
  });

  const need = (req: FastifyRequest): Actor => {
    if (!req.actor) throw unauthorized();
    return req.actor;
  };
  const needAdmin = (req: FastifyRequest): Actor => {
    const a = need(req);
    if (!a.isAdmin) throw forbidden();
    return a;
  };
  const inTx = <T>(fn: (db: any) => Promise<T>) => tx(pool, fn);

  /* ---------------- autenticação ---------------- */
  const attempts = new Map<string, { n: number; until: number }>();
  app.post('/api/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string(), password: z.string() }).parse(req.body);
    const key = `${req.ip}|${body.email.toLowerCase()}`;
    const a = attempts.get(key);
    if (a && a.n >= 10 && a.until > Date.now()) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente de novo.');
    try {
      const { token } = await auth.login(pool, body.email, body.password);
      attempts.delete(key);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/', httpOnly: true, sameSite: 'lax', secure: config.production, maxAge: config.sessionDays * 86400,
      });
      return { ok: true };
    } catch (err) {
      attempts.set(key, { n: (a && a.until > Date.now() ? a.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw err;
    }
  });
  app.post('/api/auth/logout', async (req, reply) => {
    await auth.logout(pool, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.post('/api/auth/password/forgot', async (req) => {
    const { email } = z.object({ email: z.string() }).parse(req.body);
    await inTx((db) => auth.forgotPassword(db, email));
    return { ok: true };
  });
  app.post('/api/auth/password/set', async (req) => {
    const { token, password } = z.object({ token: z.string().min(10), password: z.string() }).parse(req.body);
    await inTx((db) => auth.setPassword(db, token, password));
    return { ok: true };
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });
  app.get('/api/me', async (req) => misc.me(pool, need(req)));
  app.patch('/api/me/prefs', async (req) => {
    const { workspaceBg } = z.object({ workspaceBg: z.string().max(20).nullable() }).parse(req.body);
    await misc.setWorkspaceBg(pool, need(req), workspaceBg);
    return { ok: true };
  });

  /* ---------------- quadros e fases ---------------- */
  app.get('/api/boards', async (req) => boards.listBoards(pool, need(req)));
  app.post('/api/boards', async (req) => {
    const a = need(req);
    if (a.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros.');
    const { name } = z.object({ name: z.string().max(80) }).parse(req.body);
    return inTx((db) => boards.createBoard(db, a.id, name));
  });
  app.get('/api/boards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return boards.boardDetail(pool, need(req), id);
  });
  app.patch('/api/boards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().max(80).optional(), color: z.string().max(20).nullable().optional(), position: z.number().finite().optional() })
      .parse(req.body);
    await inTx(async (db) => {
      if (body.name !== undefined) await boards.renameBoard(db, need(req), id, body.name);
      if (body.color !== undefined) await boards.setBoardColor(db, need(req), id, body.color);
      if (body.position !== undefined) await boards.moveBoard(db, need(req), id, body.position);
    });
    return { ok: true };
  });
  app.post('/api/boards/:id/lists', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { name } = z.object({ name: z.string().max(60) }).parse(req.body);
    return inTx((db) => boards.createList(db, need(req), id, name));
  });
  app.patch('/api/lists/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ name: z.string().max(60).optional(), position: z.number().finite().optional() }).parse(req.body);
    await inTx((db) => boards.updateList(db, need(req), id, body));
    return { ok: true };
  });
  app.post('/api/lists/:id/sort', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { by } = z.object({ by: z.enum(['title', 'created', 'due']) }).parse(req.body);
    await inTx((db) => boards.sortList(db, need(req), id, by));
    return { ok: true };
  });
  app.post('/api/lists/:id/archive-done', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return inTx((db) => tasks.archiveDoneInList(db, need(req), id));
  });
  app.post('/api/lists/:id/archive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => boards.archiveList(db, need(req), id));
    return { ok: true };
  });

  /* ---------------- tarefas ---------------- */
  app.post('/api/cards', async (req) => {
    const { listId, title, description } = z.object({ listId: uuid, title: z.string().max(200), description: z.string().max(20000).optional() }).parse(req.body);
    return inTx((db) => tasks.createCard(db, need(req), listId, title, description));
  });
  app.post('/api/cards/batch', async (req) => {
    const { listId, titles } = z.object({ listId: uuid, titles: z.array(z.string().max(200)).min(1).max(tasks.MAX_BATCH) }).parse(req.body);
    return inTx((db) => tasks.createCards(db, need(req), listId, titles));
  });
  app.post('/api/cards/undo-create', async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(tasks.MAX_BATCH) }).parse(req.body);
    return inTx((db) => tasks.undoCreate(db, need(req), ids));
  });
  app.get('/api/cards/by-code/:code', async (req) => {
    const { code } = z.object({ code: z.string().max(30) }).parse(req.params);
    const id = await cardIdByCode(pool, code);
    if (!id) throw notFound('Tarefa não encontrada.');
    return cardDetail(pool, need(req), id);
  });
  app.get('/api/cards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return cardDetail(pool, need(req), id);
  });
  app.patch('/api/cards/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ title: z.string().max(200).optional(), description: z.string().max(20000).optional(), dueDate: date.optional(), isPrivate: z.boolean().optional() })
      .parse(req.body);
    await inTx((db) => tasks.updateCard(db, need(req), id, body));
    return { ok: true };
  });
  app.post('/api/cards/:id/move', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { listId, position, place } = z
      .object({ listId: uuid, position: z.number().finite().optional(), place: z.enum(['top', 'end']).optional() })
      .parse(req.body);
    await inTx((db) => tasks.moveCard(db, need(req), id, listId, position, place));
    return { ok: true };
  });
  app.post('/api/cards/:id/complete', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => tasks.completeCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/uncomplete', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => tasks.uncompleteCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/archive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => tasks.archiveCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/unarchive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => tasks.unarchiveCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/checklist', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { text } = z.object({ text: z.string().max(300) }).parse(req.body);
    return inTx((db) => tasks.addChecklistItem(db, need(req), id, text));
  });
  app.patch('/api/cards/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    const body = z.object({ text: z.string().max(300).optional(), done: z.boolean().optional() }).parse(req.body);
    await inTx((db) => tasks.updateChecklistItem(db, need(req), id, itemId, body));
    return { ok: true };
  });
  app.delete('/api/cards/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    await inTx((db) => tasks.deleteChecklistItem(db, need(req), id, itemId));
    return { ok: true };
  });
  app.post('/api/cards/:id/comments', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { body } = z.object({ body: z.string().max(5000) }).parse(req.body);
    return inTx((db) => tasks.addComment(db, need(req), id, body));
  });
  app.get('/api/cards/:id/events', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = need(req);
    const { row } = await loadCard(pool, a, id);
    if (!(await canSeeLog(pool, a, { owner_id: row.owner_id, is_private: row.is_private, delegator_id: row.d_delegator_id }))) {
      throw forbidden('O log está disponível apenas para administração, CEO e diretoria.');
    }
    return tasks.cardEvents(pool, id);
  });

  /* ---------------- delegação ---------------- */
  app.post('/api/cards/:id/delegate', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ toUserId: uuid, suggestedDue: date.optional(), note: z.string().max(5000).optional() }).parse(req.body);
    return inTx((db) => deleg.delegate(db, need(req), id, body));
  });
  app.get('/api/inbox', async (req) => deleg.inbox(pool, need(req)));
  app.post('/api/cards/:id/accept', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { listId } = z.object({ listId: uuid }).parse(req.body);
    await inTx((db) => deleg.accept(db, need(req), id, listId));
    return { ok: true };
  });
  app.post('/api/cards/:id/decline', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(2000) }).parse(req.body);
    await inTx((db) => deleg.decline(db, need(req), id, reason));
    return { ok: true };
  });
  app.get('/api/cards/:id/transfer-targets', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = need(req);
    const { row, role } = await loadCard(pool, a, id);
    if (role !== 'owner') throw forbidden();
    return deleg.transferTargets(pool, a, row.d_delegator_id ?? null);
  });
  app.post('/api/cards/:id/transfer', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { toUserId } = z.object({ toUserId: uuid }).parse(req.body);
    await inTx((db) => deleg.transfer(db, need(req), id, toUserId));
    return { ok: true };
  });
  app.post('/api/delegations/:id/ack', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => deleg.ack(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/delegations/:id/reopen', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { comment } = z.object({ comment: z.string().max(5000) }).parse(req.body);
    await inTx((db) => deleg.reopen(db, need(req), id, comment));
    return { ok: true };
  });
  app.post('/api/delegations/:id/cancel', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx((db) => deleg.cancel(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/delegations/:id/redelegate', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ toUserId: uuid, suggestedDue: date.optional() }).parse(req.body);
    await inTx((db) => deleg.redelegate(db, need(req), id, body));
    return { ok: true };
  });
  app.get('/api/delegations', async (req) => {
    const { archived } = z.object({ archived: z.enum(['0', '1']).optional() }).parse(req.query);
    return deleg.delegationsOverview(pool, need(req), archived === '1');
  });

  /* ---------------- captura da web (item 14) ---------------- */
  app.post('/api/capture', async (req) => {
    const body = z.object({ title: z.string().max(1000), url: z.string().max(2000), text: z.string().max(5000).optional() }).parse(req.body);
    return inTx((db) => captureWeb(db, need(req), body));
  });
  // Destino do "Compartilhar → SyncTasks" no Android (share_target do manifesto): leva à tela de captura.
  app.get('/compartilhar', async (req, reply) => {
    const q = z.object({ title: z.string().optional(), text: z.string().optional(), url: z.string().optional() }).parse(req.query);
    let url = q.url ?? '';
    let text = q.text ?? '';
    // O Android costuma mandar o link dentro de "text".
    if (!url) {
      const m = /https?:\/\/\S+/.exec(text);
      if (m) { url = m[0]; text = text.replace(m[0], '').trim(); }
    }
    const params = new URLSearchParams({ title: q.title ?? '', url, text });
    return reply.redirect(`/#/capturar?${params.toString()}`);
  });

  /* ---------------- painel (item 17) ---------------- */
  app.get('/api/dashboard', async (req) => dashboard(pool, need(req)));

  /* ---------------- importação do Trello ---------------- */
  app.post('/api/import/trello', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const data = trelloImportSchema.parse(req.body);
    return inTx((db) => importTrello(db, need(req), data));
  });

  /* ---------------- busca e avisos ---------------- */
  app.get('/api/search', async (req) => {
    const { q } = z.object({ q: z.string().max(200).default('') }).parse(req.query);
    return misc.search(pool, need(req), q);
  });
  app.get('/api/notifications', async (req) => misc.listNotifications(pool, need(req)));
  app.post('/api/notifications/read', async (req) => {
    await misc.markNotificationsRead(pool, need(req));
    return { ok: true };
  });

  /* ---------------- administração ---------------- */
  app.get('/api/admin/users', async (req) => {
    needAdmin(req);
    return admin.listUsers(pool);
  });
  app.post('/api/admin/users', async (req) => {
    needAdmin(req);
    const body = z
      .object({
        name: z.string().max(120),
        email: z.string().max(200),
        level: z.number().int().min(0).max(3).nullable(),
        roleTitle: z.string().max(80).optional(),
        managerId: uuid.nullable().optional(),
        isAdmin: z.boolean().optional(),
      })
      .parse(req.body);
    const { user } = await inTx((db) => admin.createUser(db, body));
    return user;
  });
  app.patch('/api/admin/users/:id', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().max(120).optional(), email: z.string().max(200).optional(), roleTitle: z.string().max(80).optional(), isAdmin: z.boolean().optional() })
      .parse(req.body);
    await inTx((db) => admin.updateUser(db, a, id, body));
    return { ok: true };
  });
  app.post('/api/admin/users/:id/transfer-management', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { managerId } = z.object({ managerId: uuid }).parse(req.body);
    return inTx((db) => admin.transferManagement(db, a, id, managerId));
  });
  app.post('/api/admin/users/:id/active', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    await inTx((db) => admin.setActive(db, a, id, active));
    return { ok: true };
  });
  app.post('/api/admin/users/:id/invite', async (req) => {
    needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(async (db) => {
      const u = (await db.query('SELECT id, name, email FROM users WHERE id = $1 AND active', [id])).rows[0];
      if (!u) throw notFound('Pessoa não encontrada.');
      await admin.sendInvite(db, u);
    });
    return { ok: true };
  });

  app.all('/api/*', async () => {
    throw notFound('Rota não encontrada.');
  });

  /* ---------------- front-end compilado ---------------- */
  if (serveWeb && fs.existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ error: 'Rota não encontrada.' });
      if (req.method !== 'GET' || req.url.startsWith('/assets/')) return reply.status(404).send('Não encontrado.');
      return reply.sendFile('index.html');
    });
  } else if (serveWeb) {
    app.log.warn(`Front-end não encontrado em ${config.webDist}. Rode "npm run build".`);
  }
  return app;
}
