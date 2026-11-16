/**
 * Revisão geral (15/11): item 99 (cabeçalhos de segurança), item 100 (aviso de problemas para a administração)
 * e item 101 (faxina diária e trava das tarefas automáticas).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setup, api, type Ctx } from './helpers.js';
import { recordError, runHealthReport, runCleanup, jobLock } from '../src/services/health.js';
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

const at = (iso: string) => new Date(iso);
const adminMails = async () =>
  (await ctx.pool.query(`SELECT subject, body FROM email_outbox WHERE to_email = $1 AND subject LIKE 'SyncTasks: aviso%'`, [ctx.users.admin.email])).rows;

describe('cabeçalhos de segurança (item 99)', () => {
  it('toda resposta proíbe ser embutida em outro site e limita de onde vem o código', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(String(r.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(r.headers['content-security-policy'])).toContain("script-src 'self'");
  });
});

describe('aviso de problemas (item 100)', () => {
  it('sem problema, nenhum e-mail; com erro ou e-mail falhado, cada admin recebe um resumo, uma vez por dia, a partir das 8h', async () => {
    await ctx.pool.query(`UPDATE app_settings SET problems_reported_at = '2026-11-01T00:00:00Z', health_report_on = NULL`);
    await ctx.pool.query(`DELETE FROM app_problems; DELETE FROM email_outbox`);
    expect(await tx(ctx.pool, (db) => runHealthReport(db, at('2026-11-02T12:00:00Z')))).toBe(0);

    await recordError(ctx.pool, 'GET /api/boards/:id', new Error('conexão caiu'));
    await ctx.pool.query(
      `INSERT INTO email_outbox (to_email, subject, body, status, attempts, last_error, created_at)
       VALUES ('x@nerus.com.br', 'Tarefa delegada', '...', 'failed', 5, 'Daily user sending limit exceeded', '2026-11-02T20:00:00Z')`,
    );
    await ctx.pool.query(`UPDATE app_problems SET created_at = '2026-11-02T20:00:00Z'`);
    // antes das 8h de Brasília (10h59 UTC = 7h59), ainda não
    expect(await tx(ctx.pool, (db) => runHealthReport(db, at('2026-11-03T10:59:00Z')))).toBe(0);
    expect(await tx(ctx.pool, (db) => runHealthReport(db, at('2026-11-03T11:05:00Z')))).toBe(1);
    const m = await adminMails();
    expect(m).toHaveLength(1);
    expect(m[0].body).toContain('1 e-mail(s) não foram enviados');
    expect(m[0].body).toContain('Daily user sending limit exceeded');
    expect(m[0].body).toContain('GET /api/boards/:id: conexão caiu');
    // no mesmo dia, não repete
    expect(await tx(ctx.pool, (db) => runHealthReport(db, at('2026-11-03T15:00:00Z')))).toBe(0);
    // no dia seguinte, só o que é novo: nada
    expect(await tx(ctx.pool, (db) => runHealthReport(db, at('2026-11-04T11:05:00Z')))).toBe(0);
  });

  it('a tela Configurações mostra os últimos 7 dias e "Tentar de novo" volta os e-mails para a fila', async () => {
    await ctx.pool.query(`DELETE FROM email_outbox`);
    await ctx.pool.query(
      `INSERT INTO email_outbox (to_email, subject, body, status, attempts, last_error) VALUES ('y@nerus.com.br', 'Resumo', '...', 'failed', 5, 'limite')`,
    );
    const h = await call('admin', 'GET', '/api/admin/health');
    expect(h.status).toBe(200);
    expect(h.body.failedMail).toBe(1);
    expect(h.body.failedSamples[0]).toMatchObject({ to: 'y@nerus.com.br', subject: 'Resumo', error: 'limite' });
    const r = await call('admin', 'POST', '/api/admin/health/retry-mail');
    expect(r.body.queued).toBe(1);
    const row = (await ctx.pool.query(`SELECT status, attempts FROM email_outbox`)).rows[0];
    expect(row).toEqual({ status: 'pending', attempts: 0 });
    expect((await call('gest', 'GET', '/api/admin/health')).status).toBe(403);
  });
});

describe('faxina diária (item 101)', () => {
  it('apaga só o que ninguém usa mais, uma vez por dia; tarefas e log ficam', async () => {
    const before = (await ctx.pool.query(`SELECT (SELECT count(*) FROM cards)::int AS cards, (SELECT count(*) FROM card_events)::int AS events`)).rows[0];
    await ctx.pool.query(`UPDATE app_settings SET cleanup_on = NULL`);
    await ctx.pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('velha', $1, now() - interval '1 day')`, [ctx.users.func.id]);
    await ctx.pool.query(
      `INSERT INTO email_outbox (to_email, subject, body, status, sent_at) VALUES
         ('a@nerus.com.br', 'antigo', '.', 'sent', now() - interval '100 days'),
         ('a@nerus.com.br', 'recente', '.', 'sent', now() - interval '10 days')`,
    );
    await ctx.pool.query(
      `INSERT INTO notifications (user_id, type, text, read_at) VALUES
         ($1, 'x', 'lido há muito', now() - interval '200 days'),
         ($1, 'x', 'lido ontem', now() - interval '1 day'),
         ($1, 'x', 'não lido', NULL)`,
      [ctx.users.func.id],
    );
    const r = await tx(ctx.pool, (db) => runCleanup(db));
    expect(r).toMatchObject({ sessions: 1, emails: 1, notifications: 1 });
    expect(await tx(ctx.pool, (db) => runCleanup(db))).toBeNull();
    const left = (await ctx.pool.query(`SELECT text FROM notifications WHERE user_id = $1 AND type = 'x' ORDER BY text`, [ctx.users.func.id])).rows.map((x) => x.text);
    expect(left).toEqual(['lido ontem', 'não lido']);
    // quem estava com login válido continua entrando
    expect((await call('func', 'GET', '/api/me')).status).toBe(200);
    const after = (await ctx.pool.query(`SELECT (SELECT count(*) FROM cards)::int AS cards, (SELECT count(*) FROM card_events)::int AS events`)).rows[0];
    expect(after).toEqual(before);
  });

  it('trava: duas tarefas automáticas iguais ao mesmo tempo, só uma roda', async () => {
    const c1 = await ctx.pool.connect();
    const c2 = await ctx.pool.connect();
    try {
      await c1.query('BEGIN');
      await c2.query('BEGIN');
      expect(await jobLock(c1, 'teste')).toBe(true);
      expect(await jobLock(c2, 'teste')).toBe(false);
      expect(await jobLock(c2, 'outra')).toBe(true);
    } finally {
      await c1.query('ROLLBACK');
      await c2.query('ROLLBACK');
      c1.release();
      c2.release();
    }
  });
});
