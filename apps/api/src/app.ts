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
import * as subs from './services/substitution.js';
import { importTrello, trelloImportSchema } from './services/importer.js';
import { exportAll } from './services/exporter.js';
import { captureWeb } from './services/capture.js';
import { dashboard } from './services/dashboard.js';
import { listArchived } from './services/archived.js';
import * as table from './services/table.js';
import { cardDetail, cardIdByCode, loadCard } from './services/cards.js';
import { canSeeLog } from './services/actors.js';
import * as oauth from './services/oauth.js';
import { handleRpc } from './services/mcp.js';
import { isoDate } from './lib/dates.js';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
  }
}

const SESSION_COOKIE = 'synctasks_sid';

/** Item 72: o que o substituto pode fazer em nome da pessoa (o resto responde 403). */
const SUBSTITUTE_ROUTES = new Set([
  'GET /api/me',
  'GET /api/boards', 'POST /api/boards', 'GET /api/boards/archived', 'GET /api/boards/:id', 'PATCH /api/boards/:id', 'POST /api/boards/:id/archive',
  'POST /api/boards/:id/unarchive', 'POST /api/boards/:id/lists', 'GET /api/boards/:id/match',
  'PATCH /api/lists/:id', 'POST /api/lists/:id/sort', 'POST /api/lists/:id/archive-done', 'POST /api/lists/:id/archive',
  'POST /api/cards', 'POST /api/cards/batch', 'POST /api/cards/undo-create', 'GET /api/cards/by-code/:code', 'GET /api/cards/:id', 'PATCH /api/cards/:id',
  'POST /api/cards/:id/move', 'POST /api/cards/:id/complete', 'POST /api/cards/:id/uncomplete', 'POST /api/cards/:id/archive', 'POST /api/cards/:id/unarchive',
  'POST /api/cards/:id/checklist', 'PATCH /api/cards/:id/checklist/:itemId', 'DELETE /api/cards/:id/checklist/:itemId', 'POST /api/cards/:id/comments',
  'POST /api/cards/:id/delegate', 'GET /api/inbox', 'POST /api/cards/:id/accept', 'POST /api/cards/:id/accept-delegate', 'POST /api/inbox/discard',
  'POST /api/inbox/restore', 'POST /api/cards/:id/decline', 'GET /api/cards/:id/transfer-targets', 'POST /api/cards/:id/transfer',
  'POST /api/delegations/:id/ack', 'POST /api/delegations/:id/reopen', 'POST /api/delegations/:id/cancel', 'POST /api/delegations/:id/undo-cancel', 'POST /api/delegations/:id/resume',
  'POST /api/delegations/:id/redelegate', 'POST /api/delegations/:id/no-pass', 'GET /api/delegations',
  'GET /api/dashboard', 'GET /api/archived', 'GET /api/table', 'GET /api/table/options', 'GET /api/filters', 'POST /api/filters', 'PATCH /api/filters/:id',
  'DELETE /api/filters/:id', 'GET /api/search',
]);
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
    if (!req.url.startsWith('/api/')) return;
    req.actor = await auth.actorFromSession(pool, req.cookies[SESSION_COOKIE]);
    // Item 72: com o seletor "Substituindo…" ligado, o pedido vale em nome da pessoa substituída,
    // só nas telas de tarefas (nada de dados pessoais, avisos, log, administração ou exportação).
    const como = req.headers['x-synctasks-como'];
    if (req.actor && typeof como === 'string' && como) {
      if (!SUBSTITUTE_ROUTES.has(`${req.method} ${req.routeOptions.url}`)) throw forbidden('Isso não fica disponível durante a substituição.');
      req.actor = await subs.actAs(pool, req.actor, como);
    }
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
  // Item 72: na substituição, a transação guarda quem age de fato; o banco grava isso no log, nos comentários
  // e nas tarefas criadas (colunas via_user_id e created_via).
  const inTx = <T>(req: FastifyRequest, fn: (db: any) => Promise<T>) =>
    tx(pool, async (db) => {
      const via = req.actor?.sub?.id;
      if (via) await db.query(`SELECT set_config('synctasks.via', $1, true)`, [via]);
      return fn(db);
    });

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
    await inTx(req, (db) => auth.forgotPassword(db, email));
    return { ok: true };
  });
  app.post('/api/auth/password/set', async (req) => {
    const { token, password } = z.object({ token: z.string().min(10), password: z.string() }).parse(req.body);
    await inTx(req, (db) => auth.setPassword(db, token, password));
    return { ok: true };
  });

  app.get('/api/health', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });
  app.get('/api/me', async (req) => misc.me(pool, need(req)));
  app.patch('/api/me/prefs', async (req) => {
    const body = z
      .object({ workspaceBg: z.string().max(20).nullable().optional(), emailDigest: z.boolean().optional(), emailDue: z.boolean().optional(), hideInactive: z.boolean().optional() })
      .parse(req.body);
    const a = need(req);
    if (body.workspaceBg !== undefined) await misc.setWorkspaceBg(pool, a, body.workspaceBg);
    if (body.emailDigest !== undefined || body.emailDue !== undefined) await misc.setEmailPrefs(pool, a, body);
    if (body.hideInactive !== undefined) await misc.setHideInactive(pool, a, body.hideInactive);
    return { ok: true };
  });

  /* ---------------- quadros e fases ---------------- */
  app.get('/api/boards', async (req) => boards.listBoards(pool, need(req)));
  app.post('/api/boards', async (req) => {
    const a = need(req);
    if (a.level === null) throw forbidden('Administradores fora da hierarquia não têm quadros.');
    const { name } = z.object({ name: z.string().max(80) }).parse(req.body);
    return inTx(req, (db) => boards.createBoard(db, a.id, name));
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
    await inTx(req, async (db) => {
      if (body.name !== undefined) await boards.renameBoard(db, need(req), id, body.name);
      if (body.color !== undefined) await boards.setBoardColor(db, need(req), id, body.color);
      if (body.position !== undefined) await boards.moveBoard(db, need(req), id, body.position);
    });
    return { ok: true };
  });
  app.get('/api/boards/archived', async (req) => boards.listArchivedBoards(pool, need(req)));
  app.post('/api/boards/:id/archive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => boards.archiveBoard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/boards/:id/unarchive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { back } = z.object({ back: z.enum(['end', 'same']).default('end') }).parse(req.body ?? {});
    await inTx(req, (db) => boards.unarchiveBoard(db, need(req), id, back));
    return { ok: true };
  });
  app.post('/api/boards/:id/lists', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { name } = z.object({ name: z.string().max(60) }).parse(req.body);
    return inTx(req, (db) => boards.createList(db, need(req), id, name));
  });
  app.patch('/api/lists/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ name: z.string().max(60).optional(), position: z.number().finite().optional() }).parse(req.body);
    await inTx(req, (db) => boards.updateList(db, need(req), id, body));
    return { ok: true };
  });
  app.post('/api/lists/:id/sort', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { by } = z.object({ by: z.enum(['title', 'created', 'due']) }).parse(req.body);
    await inTx(req, (db) => boards.sortList(db, need(req), id, by));
    return { ok: true };
  });
  app.post('/api/lists/:id/archive-done', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return inTx(req, (db) => tasks.archiveDoneInList(db, need(req), id));
  });
  app.post('/api/lists/:id/archive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => boards.archiveList(db, need(req), id));
    return { ok: true };
  });

  /* ---------------- tarefas ---------------- */
  app.post('/api/cards', async (req) => {
    const { listId, title, description } = z.object({ listId: uuid, title: z.string().max(200), description: z.string().max(20000).optional() }).parse(req.body);
    return inTx(req, (db) => tasks.createCard(db, need(req), listId, title, description));
  });
  app.post('/api/cards/batch', async (req) => {
    const { listId, titles } = z.object({ listId: uuid, titles: z.array(z.string().max(200)).min(1).max(tasks.MAX_BATCH) }).parse(req.body);
    return inTx(req, (db) => tasks.createCards(db, need(req), listId, titles));
  });
  app.post('/api/cards/undo-create', async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(tasks.MAX_BATCH) }).parse(req.body);
    return inTx(req, (db) => tasks.undoCreate(db, need(req), ids));
  });
  app.get('/api/cards/by-code/:code', async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.params);
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
      .object({ title: z.string().max(200).optional(), description: z.string().max(20000).optional(), dueDate: date.optional(), isPrivate: z.boolean().optional(), color: z.string().max(20).nullable().optional() })
      .parse(req.body);
    await inTx(req, (db) => tasks.updateCard(db, need(req), id, body));
    return { ok: true };
  });
  app.post('/api/cards/:id/move', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { listId, position, place } = z
      .object({ listId: uuid, position: z.number().finite().optional(), place: z.enum(['top', 'end']).optional() })
      .parse(req.body);
    await inTx(req, (db) => tasks.moveCard(db, need(req), id, listId, position, place));
    return { ok: true };
  });
  app.post('/api/cards/:id/complete', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => tasks.completeCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/uncomplete', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => tasks.uncompleteCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/archive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => tasks.archiveCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/unarchive', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => tasks.unarchiveCard(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/cards/:id/checklist', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { text } = z.object({ text: z.string().max(300) }).parse(req.body);
    return inTx(req, (db) => tasks.addChecklistItem(db, need(req), id, text));
  });
  app.patch('/api/cards/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    const body = z.object({ text: z.string().max(300).optional(), done: z.boolean().optional() }).parse(req.body);
    await inTx(req, (db) => tasks.updateChecklistItem(db, need(req), id, itemId, body));
    return { ok: true };
  });
  app.delete('/api/cards/:id/checklist/:itemId', async (req) => {
    const { id, itemId } = z.object({ id: uuid, itemId: uuid }).parse(req.params);
    await inTx(req, (db) => tasks.deleteChecklistItem(db, need(req), id, itemId));
    return { ok: true };
  });
  app.post('/api/cards/:id/comments', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { body } = z.object({ body: z.string().max(5000) }).parse(req.body);
    return inTx(req, (db) => tasks.addComment(db, need(req), id, body));
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
    const body = z.object({ toUserId: uuid, suggestedDue: date.optional(), note: z.string().max(5000).optional(), noPass: z.boolean().optional() }).parse(req.body);
    return inTx(req, (db) => deleg.delegate(db, need(req), id, body));
  });
  app.get('/api/inbox', async (req) => deleg.inbox(pool, need(req)));
  app.post('/api/cards/:id/accept', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { listId } = z.object({ listId: uuid }).parse(req.body);
    await inTx(req, (db) => deleg.accept(db, need(req), id, listId));
    return { ok: true };
  });
  app.post('/api/cards/:id/accept-delegate', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ listId: uuid, toUserId: uuid, suggestedDue: date.optional(), note: z.string().max(5000).optional(), noPass: z.boolean().optional() }).parse(req.body);
    return inTx(req, (db) => deleg.acceptAndDelegate(db, need(req), id, body));
  });
  app.post('/api/inbox/discard', async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(tasks.MAX_DISCARD) }).parse(req.body);
    return inTx(req, (db) => tasks.discardFromInbox(db, need(req), ids));
  });
  app.post('/api/inbox/restore', async (req) => {
    const { ids } = z.object({ ids: z.array(uuid).min(1).max(tasks.MAX_DISCARD) }).parse(req.body);
    return inTx(req, (db) => tasks.restoreDiscarded(db, need(req), ids));
  });
  app.post('/api/cards/:id/decline', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { reason } = z.object({ reason: z.string().max(2000) }).parse(req.body);
    await inTx(req, (db) => deleg.decline(db, need(req), id, reason));
    return { ok: true };
  });
  app.get('/api/cards/:id/transfer-targets', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const a = need(req);
    const { row, role } = await loadCard(pool, a, id);
    if (role !== 'owner') throw forbidden();
    return deleg.transferTargets(pool, a, row.d_delegator_id ?? null, !!(row.d_id && row.d_no_pass));
  });
  app.post('/api/cards/:id/transfer', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { toUserId } = z.object({ toUserId: uuid }).parse(req.body);
    await inTx(req, (db) => deleg.transfer(db, need(req), id, toUserId));
    return { ok: true };
  });
  app.post('/api/delegations/:id/ack', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => deleg.ack(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/delegations/:id/reopen', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { comment } = z.object({ comment: z.string().max(5000) }).parse(req.body);
    await inTx(req, (db) => deleg.reopen(db, need(req), id, comment));
    return { ok: true };
  });
  app.post('/api/delegations/:id/cancel', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => deleg.cancel(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/delegations/:id/undo-cancel', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => deleg.undoCancel(db, need(req), id));
    return { ok: true };
  });
  app.post('/api/delegations/:id/resume', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    return inTx(req, (db) => deleg.resume(db, need(req), id));
  });
  app.post('/api/delegations/:id/redelegate', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ toUserId: uuid, suggestedDue: date.optional(), noPass: z.boolean().optional() }).parse(req.body);
    await inTx(req, (db) => deleg.redelegate(db, need(req), id, body));
    return { ok: true };
  });
  app.post('/api/delegations/:id/no-pass', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { noPass } = z.object({ noPass: z.boolean() }).parse(req.body);
    await inTx(req, (db) => deleg.setNoPass(db, need(req), id, noPass));
    return { ok: true };
  });
  app.get('/api/delegations', async (req) => {
    const { archived } = z.object({ archived: z.enum(['0', '1']).optional() }).parse(req.query);
    return deleg.delegationsOverview(pool, need(req), archived === '1');
  });

  /* ---------------- captura da web (item 14) ---------------- */
  app.post('/api/capture', async (req) => {
    const body = z.object({ title: z.string().max(1000), url: z.string().max(2000), text: z.string().max(5000).optional() }).parse(req.body);
    return inTx(req, (db) => captureWeb(db, need(req), body));
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

  /* ---------------- exportar tarefas em JSON (item 62) ---------------- */
  app.get('/api/export', async (req) => exportAll(pool, need(req)));

  /* ---------------- importação (arquivo do Trello ou do SyncTasks) ---------------- */
  app.post('/api/import/trello', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
    const data = trelloImportSchema.parse(req.body);
    return inTx(req, (db) => importTrello(db, need(req), data));
  });

  /* ---------------- arquivadas (item 35) ---------------- */
  app.get('/api/archived', async (req) => {
    const a = need(req);
    const { q, offset } = z.object({ q: z.string().max(200).default(''), offset: z.coerce.number().int().min(0).max(100000).default(0) }).parse(req.query);
    return listArchived(pool, a, q, offset);
  });

  /* ---------------- tabela com filtros (item 36) ---------------- */
  app.get('/api/table', async (req) => {
    const a = need(req);
    const query = z
      .object({
        filter: z.string().max(20000).default('{}'),
        sort: z.enum(Object.keys(table.SORTS) as [table.SortKey, ...table.SortKey[]]).default('due'),
        dir: z.enum(['asc', 'desc']).default('asc'),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
        limit: z.coerce.number().int().min(1).max(table.TABLE_MAX).default(table.TABLE_PAGE),
      })
      .parse(req.query);
    let raw: unknown;
    try {
      raw = JSON.parse(query.filter);
    } catch {
      throw new HttpError(422, 'Filtro inválido.');
    }
    return table.tableRows(pool, a, table.filterSchema.parse(raw), query.sort, query.dir, query.offset, query.limit);
  });
  // Item 47: o mesmo filtro da tabela no quadro aberto. Devolve quais tarefas do quadro atendem ao filtro.
  app.get('/api/boards/:id/match', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { filter } = z.object({ filter: z.string().max(20000).default('{}') }).parse(req.query);
    let raw: unknown;
    try {
      raw = JSON.parse(filter);
    } catch {
      throw new HttpError(422, 'Filtro inválido.');
    }
    return table.boardMatches(pool, need(req), id, table.filterSchema.parse(raw));
  });
  app.get('/api/table/options', async (req) => table.tableOptions(pool, need(req)));
  app.get('/api/filters', async (req) => table.listFilters(pool, need(req)));
  app.post('/api/filters', async (req) => {
    const { name, filter } = z.object({ name: z.string().max(80), filter: table.filterSchema }).parse(req.body);
    return inTx(req, (db) => table.createFilter(db, need(req), name, filter));
  });
  app.patch('/api/filters/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z.object({ name: z.string().max(80).optional(), filter: table.filterSchema.optional() }).parse(req.body);
    return inTx(req, (db) => table.updateFilter(db, need(req), id, body));
  });
  app.delete('/api/filters/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, (db) => table.deleteFilter(db, need(req), id));
    return { ok: true };
  });

  /* ---------------- busca e avisos ---------------- */
  app.get('/api/search', async (req) => {
    const { q, board } = z.object({ q: z.string().max(200).default(''), board: uuid.optional() }).parse(req.query);
    return misc.search(pool, need(req), q, board);
  });
  app.get('/api/notifications', async (req) => misc.listNotifications(pool, need(req)));
  app.post('/api/notifications/read', async (req) => {
    await misc.markNotificationsRead(pool, need(req));
    return { ok: true };
  });

  /* ---------------- substituição em férias e ausências (item 72) ---------------- */
  // A própria pessoa (sem userId) ou a administração (com o userId de quem saiu de surpresa).
  const subTarget = (req: FastifyRequest, userId?: string) => {
    const a = need(req);
    return { a, id: userId ?? a.id };
  };
  app.get('/api/substitution', async (req) => {
    const { userId } = z.object({ userId: uuid.optional() }).parse(req.query);
    const { a, id } = subTarget(req, userId);
    return subs.overview(pool, a, id);
  });
  app.post('/api/substitution', async (req) => {
    const body = z.object({ userId: uuid.optional(), substituteId: uuid, shareCommon: z.boolean(), endsOn: date.optional() }).parse(req.body);
    const { a, id } = subTarget(req, body.userId);
    return inTx(req, (db) => subs.start(db, a, id, { substituteId: body.substituteId, shareCommon: body.shareCommon, endsOn: body.endsOn ?? null }));
  });
  app.post('/api/substitution/end', async (req) => {
    const { userId } = z.object({ userId: uuid.optional() }).parse(req.body ?? {});
    const { a, id } = subTarget(req, userId);
    return inTx(req, (db) => subs.end(db, a, id));
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
    const { user } = await inTx(req, (db) => admin.createUser(db, body));
    return user;
  });
  app.patch('/api/admin/users/:id', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const body = z
      .object({ name: z.string().max(120).optional(), email: z.string().max(200).optional(), roleTitle: z.string().max(80).optional(), isAdmin: z.boolean().optional(), managerId: uuid.optional() })
      .parse(req.body);
    // Item 33: trocar o superior direto em "Editar dados" faz a transferência de gestão, na mesma transação.
    const { managerId, ...data } = body;
    return inTx(req, async (db) => {
      await admin.updateUser(db, a, id, data);
      const moved = managerId ? (await admin.transferManagement(db, a, id, managerId)).moved : null;
      return { ok: true, moved };
    });
  });
  app.post('/api/admin/users/:id/transfer-management', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { managerId } = z.object({ managerId: uuid }).parse(req.body);
    return inTx(req, (db) => admin.transferManagement(db, a, id, managerId));
  });
  app.post('/api/admin/users/:id/active', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    await inTx(req, (db) => admin.setActive(db, a, id, active));
    return { ok: true };
  });
  app.get('/api/admin/users/:id/deactivation', async (req) => {
    needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    return admin.deactivationPreview(pool, id);
  });
  app.post('/api/admin/users/:id/deactivate', async (req) => {
    const a = needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    const { successorId } = z.object({ successorId: uuid.nullable().optional() }).parse(req.body);
    return inTx(req, (db) => admin.deactivate(db, a, id, successorId ?? null));
  });
  app.post('/api/admin/users/:id/invite', async (req) => {
    needAdmin(req);
    const { id } = z.object({ id: uuid }).parse(req.params);
    await inTx(req, async (db) => {
      const u = (await db.query('SELECT id, name, email FROM users WHERE id = $1 AND active', [id])).rows[0];
      if (!u) throw notFound('Pessoa não encontrada.');
      await admin.sendInvite(db, u);
    });
    return { ok: true };
  });

  /* ---------------- conector para assistentes de IA: OAuth + MCP (item 65) ---------------- */
  // O formulário do /oauth/token chega como application/x-www-form-urlencoded.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });
  // Estas rotas não usam o cookie do app (só a chave do assistente), então podem ser chamadas de qualquer origem.
  const OPEN = /^\/(mcp|oauth\/(token|register)|\.well-known\/)/;
  app.addHook('onRequest', async (req, reply) => {
    if (!OPEN.test(req.url)) return;
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
      return reply.status(204).send();
    }
  });
  const base = (req: FastifyRequest) => `${req.protocol}://${req.host}`;
  const oauthFail = (reply: any, err: unknown) => {
    if (err instanceof oauth.OAuthError) return reply.status(err.status).send({ error: err.code, error_description: err.message });
    throw err;
  };
  const resourceMeta = async (req: FastifyRequest) => ({
    resource: `${base(req)}/mcp`,
    authorization_servers: [base(req)],
    bearer_methods_supported: ['header'],
    resource_name: 'SyncTasks',
  });
  app.get('/.well-known/oauth-protected-resource', resourceMeta);
  app.get('/.well-known/oauth-protected-resource/mcp', resourceMeta);
  app.get('/.well-known/oauth-authorization-server', async (req) => ({
    issuer: base(req),
    authorization_endpoint: `${base(req)}/oauth/authorize`,
    token_endpoint: `${base(req)}/oauth/token`,
    registration_endpoint: `${base(req)}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['tarefas'],
  }));
  app.post('/oauth/register', async (req, reply) => {
    try {
      return reply.status(201).send(await inTx(req, (db) => oauth.registerClient(db, req.body)));
    } catch (err) {
      return oauthFail(reply, err);
    }
  });
  // Leva à tela "Permitir" do app (que pede o login antes, se preciso), com os mesmos parâmetros.
  app.get('/oauth/authorize', async (req, reply) => {
    const q = z.record(z.string()).parse(req.query);
    return reply.redirect(`/#/conectar?${new URLSearchParams(q).toString()}`);
  });
  app.post('/oauth/token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      const body = z.record(z.string().max(4000)).catch({}).parse(req.body ?? {});
      return await inTx(req, (db) => oauth.token(db, body));
    } catch (err) {
      return oauthFail(reply, err);
    }
  });
  app.post('/mcp', { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const actor = await oauth.actorFromAccessToken(pool, req.headers.authorization);
    if (!actor) {
      reply.header('WWW-Authenticate', `Bearer resource_metadata="${base(req)}/.well-known/oauth-protected-resource/mcp"`);
      return reply.status(401).send({ error: 'invalid_token', error_description: 'Conecte o SyncTasks de novo no assistente.' });
    }
    const body = req.body as any;
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => handleRpc(pool, actor, m)))).filter(Boolean);
      return out.length ? out : reply.status(202).send();
    }
    const res = await handleRpc(pool, actor, body);
    return res ?? reply.status(202).send();
  });
  // Sem canal de eventos (SSE): tudo é pedido e resposta.
  app.get('/mcp', async (_req, reply) => reply.status(405).header('Allow', 'POST').send({ error: 'Use POST.' }));
  app.delete('/mcp', async (_req, reply) => reply.status(405).header('Allow', 'POST').send({ error: 'Use POST.' }));

  // A tela "Permitir": quem está pedindo acesso, e a decisão da pessoa logada.
  app.get('/api/oauth/request', async (req) => {
    need(req);
    const p = oauth.authorizeSchema.parse(req.query);
    const { client, problem } = await oauth.checkAuthorize(pool, p);
    return { name: client.name, host: client.host, problem };
  });
  app.post('/api/oauth/decide', async (req) => {
    const a = need(req);
    const body = oauth.authorizeSchema.extend({ allow: z.boolean() }).parse(req.body);
    const { allow, ...p } = body;
    return inTx(req, (db) => oauth.decide(db, a, p, allow));
  });
  // Meus dados: assistentes ligados à conta.
  app.get('/api/me/assistants', async (req) => oauth.listGrants(pool, need(req)));
  app.delete('/api/me/assistants/:id', async (req) => {
    const { id } = z.object({ id: uuid }).parse(req.params);
    await oauth.revokeGrant(pool, need(req), id);
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
