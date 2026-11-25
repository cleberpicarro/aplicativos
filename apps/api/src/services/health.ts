import { config } from '../config.js';
import { one, many, type Db, type Pool } from '../lib/db.js';
import { forbidden } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { queueEmail } from './notify.js';

/*
 * Item 100 (revisão geral, R5): alguém fica sabendo quando algo dá errado.
 * - Erro inesperado do servidor (resposta 500) fica guardado em app_problems.
 * - Uma vez por dia, a partir das 8h (Brasília), se houve erro, e-mail que falhou ou e-mail parado na fila,
 *   cada administrador recebe um e-mail com o resumo. Sem problema, nenhum e-mail.
 * - A tela Configurações mostra o mesmo resumo dos últimos 7 dias e deixa tentar de novo os e-mails que falharam.
 *
 * Item 101 (R8): faxina diária. Apaga só o que ninguém usa mais: logins vencidos, links de senha vencidos,
 * e-mails enviados há mais de 90 dias, avisos lidos há mais de 180 dias e problemas com mais de 90 dias.
 * Tarefas, comentários e o log das tarefas nunca são apagados.
 */

export const REPORT_FROM_HOUR = 8;
/** E-mail na fila há mais tempo que isso conta como "parado". */
const STUCK_MINUTES = 60;

/** Guarda um erro inesperado. Nunca derruba nada: se falhar, só fica no log. */
export async function recordError(pool: Pool, where: string, err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await pool.query(`INSERT INTO app_problems (detail) VALUES ($1)`, [`${where}: ${msg}`.slice(0, 500)]);
}

export interface HealthSummary {
  errors: number;
  errorSamples: { detail: string; count: number; last: string }[];
  failedMail: number;
  failedSamples: { id: string; to: string; subject: string; error: string | null; at: string }[];
  stuckMail: number;
  /** Item 122: delegações fora de sincronia agora (não depende do período). */
  syncIssues: number;
  syncSamples: { kind: 'estado' | 'neta'; text: string }[];
}

/**
 * Item 122: conferência das delegações. Procura, nos dados de agora:
 * - "estado": a situação da delegação não bate com a tarefa (ex.: "em andamento" mas fora do quadro);
 * - "neta": delegação repassada para baixo ainda em aberto, mas a tarefa do meio já saiu de quem a repassou
 *   (cancelada, devolvida, concluída ou arquivada). Quando o acompanhamento passou a outra pessoa de propósito
 *   (desativação com sucessor, troca de superior), não conta. As regras do item 122 impedem casos novos; as netas
 *   anteriores à correção (24/11/2026, 20h) ficam de fora porque o Cleber decidiu que seguem como estão (ex.: #6 com o Marcelo Jr.).
 */
export const NETA_DESDE = '2026-11-24T20:00:00-03:00';
export async function syncCheck(db: Db): Promise<{ syncIssues: number; syncSamples: HealthSummary['syncSamples'] }> {
  const rows = await many(
    db,
    `SELECT 'estado' AS kind, u.name AS who, c.num, c.title, d.status, NULL::text AS other
       FROM delegations d JOIN cards c ON c.id = d.card_id JOIN users u ON u.id = c.owner_id
      WHERE (d.status = 'PENDING_ACCEPT' AND (c.list_id IS NOT NULL OR c.archived_at IS NOT NULL OR c.completed_at IS NOT NULL))
         OR (d.status = 'IN_PROGRESS'    AND (c.list_id IS NULL OR c.completed_at IS NOT NULL OR c.archived_at IS NOT NULL))
         OR (d.status = 'AWAITING_ACK'   AND (c.completed_at IS NULL OR c.archived_at IS NOT NULL))
         OR (d.status = 'DECLINED'       AND (c.list_id IS NOT NULL OR c.archived_at IS NOT NULL))
         OR (d.status IN ('ACKED','CANCELED') AND c.archived_at IS NULL)
     UNION ALL
     SELECT 'neta', u.name, c.num, c.title, d.status, g.name
       FROM delegations d JOIN cards c ON c.id = d.card_id JOIN users u ON u.id = c.owner_id JOIN users g ON g.id = d.delegator_id
       JOIN cards p ON p.id = d.parent_card_id LEFT JOIN delegations pd ON pd.card_id = p.id
      WHERE d.status IN ('PENDING_ACCEPT','IN_PROGRESS','AWAITING_ACK','DECLINED') AND d.created_at >= $1::timestamptz
        AND p.owner_id = d.delegator_id AND (p.archived_at IS NOT NULL OR pd.status IN ('DECLINED','CANCELED','ACKED','AWAITING_ACK'))
      ORDER BY 1, 3`,
    [NETA_DESDE],
  );
  const label: Record<string, string> = { PENDING_ACCEPT: 'na caixa de entrada', IN_PROGRESS: 'em andamento', AWAITING_ACK: 'aguardando ciente', DECLINED: 'devolvida', ACKED: 'com ciente', CANCELED: 'cancelada' };
  const syncSamples = rows.slice(0, 10).map((r) => ({
    kind: r.kind as 'estado' | 'neta',
    text: r.kind === 'neta'
      ? `#${r.num} “${r.title}”: ${r.who} está com ela (${label[r.status]}), delegada por ${r.other}, mas a tarefa de ${r.other} já foi encerrada.`
      : `#${r.num} “${r.title}” de ${r.who}: a delegação diz “${label[r.status]}”, mas a tarefa não está nessa situação.`,
  }));
  return { syncIssues: rows.length, syncSamples };
}

async function summary(db: Db, since: string): Promise<HealthSummary> {
  const e = await one(db, `SELECT count(*)::int AS n FROM app_problems WHERE created_at > $1`, [since]);
  const errorSamples = await many(
    db,
    `SELECT detail, count(*)::int AS count, max(created_at) AS last FROM app_problems WHERE created_at > $1
      GROUP BY detail ORDER BY max(created_at) DESC LIMIT 5`,
    [since],
  );
  const f = await one(db, `SELECT count(*)::int AS n FROM email_outbox WHERE status = 'failed' AND created_at > $1`, [since]);
  const failedSamples = await many(
    db,
    `SELECT id, to_email AS "to", subject, last_error AS error, created_at AS at FROM email_outbox
      WHERE status = 'failed' AND created_at > $1 ORDER BY created_at DESC LIMIT 10`,
    [since],
  );
  const s = await one(
    db,
    `SELECT count(*)::int AS n FROM email_outbox WHERE status = 'pending' AND created_at < now() - ($1 || ' minutes')::interval`,
    [String(STUCK_MINUTES)],
  );
  return {
    errors: e.n,
    errorSamples: errorSamples.map((r) => ({ ...r, last: new Date(r.last).toISOString() })),
    failedMail: f.n,
    failedSamples: failedSamples.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
    stuckMail: s.n,
    ...(await syncCheck(db)),
  };
}

/** Para a tela Configurações (só administração): últimos 7 dias. */
export async function getHealth(db: Db, a: Actor): Promise<HealthSummary> {
  if (!a.isAdmin) throw forbidden();
  return summary(db, new Date(Date.now() - 7 * 86400_000).toISOString());
}

/** Põe de novo na fila os e-mails que falharam nos últimos 7 dias (por exemplo, depois que o limite do Gmail voltou). */
export async function retryFailedMail(db: Db, a: Actor): Promise<{ queued: number }> {
  if (!a.isAdmin) throw forbidden();
  const r = await db.query(
    `UPDATE email_outbox SET status = 'pending', attempts = 0 WHERE status = 'failed' AND created_at > now() - interval '7 days'`,
  );
  return { queued: r.rowCount ?? 0 };
}

const clockSql = `SELECT (l)::date::text AS today, extract(hour FROM l)::int AS hour
                    FROM (SELECT $1::timestamptz AT TIME ZONE 'America/Sao_Paulo' AS l) x`;

/** Aviso diário para a administração. Devolve quantos e-mails entraram na fila. `at` é o "agora" (testes). */
export async function runHealthReport(db: Db, at: Date = new Date()): Promise<number> {
  const clock = await one(db, clockSql, [at.toISOString()]);
  if (clock.hour < REPORT_FROM_HOUR) return 0;
  const st = await one(
    db,
    `SELECT problems_reported_at AS since FROM app_settings
      WHERE health_report_on IS DISTINCT FROM $1::date FOR UPDATE SKIP LOCKED`,
    [clock.today],
  );
  if (!st) return 0;
  const since = new Date(st.since).toISOString();
  const s = await summary(db, since);
  await db.query(`UPDATE app_settings SET problems_reported_at = $1, health_report_on = $2::date`, [at.toISOString(), clock.today]);
  if (!s.errors && !s.failedMail && !s.stuckMail && !s.syncIssues) return 0;

  const lines: string[] = ['Olá! Este é o aviso diário do SyncTasks, enviado só quando algo não saiu como devia.', ''];
  if (s.failedMail) {
    lines.push(`• ${s.failedMail} e-mail(s) não foram enviados (o app tentou 5 vezes cada).`);
    for (const m of s.failedSamples.slice(0, 5)) lines.push(`   - para ${m.to}: “${m.subject}”${m.error ? ` (motivo: ${m.error.slice(0, 160)})` : ''}`);
    lines.push('  Uma causa comum é o limite diário de envios da conta de e-mail. Em Configurações há o botão “Tentar de novo”.');
  }
  if (s.stuckMail) lines.push(`• ${s.stuckMail} e-mail(s) estão na fila há mais de ${STUCK_MINUTES} minutos, sem conseguir sair.`);
  if (s.errors) {
    lines.push(`• ${s.errors} erro(s) inesperado(s) no servidor. Os mais recentes:`);
    for (const e of s.errorSamples) lines.push(`   - ${e.detail}${e.count > 1 ? ` (${e.count} vezes)` : ''}`);
  }
  if (s.syncIssues) {
    lines.push(`• ${s.syncIssues} delegação(ões) fora de sincronia:`);
    for (const x of s.syncSamples) lines.push(`   - ${x.text}`);
    lines.push('  Isso não deveria acontecer. Encaminhe este e-mail para quem cuida do SyncTasks investigar.');
  }
  lines.push('', `Detalhes em Configurações: ${config.appUrl}/#/configuracoes`);
  const admins = await many(db, `SELECT email FROM users WHERE is_admin AND active ORDER BY name`);
  for (const ad of admins) await queueEmail(db, ad.email, 'SyncTasks: aviso de problemas', lines.join('\n'));
  return admins.length;
}

export interface CleanupResult { sessions: number; tokens: number; emails: number; notifications: number; problems: number }

/** Faxina, uma vez por dia. */
export async function runCleanup(db: Db, at: Date = new Date()): Promise<CleanupResult | null> {
  const clock = await one(db, clockSql, [at.toISOString()]);
  const st = await one(db, `SELECT 1 FROM app_settings WHERE cleanup_on IS DISTINCT FROM $1::date FOR UPDATE SKIP LOCKED`, [clock.today]);
  if (!st) return null;
  const now = at.toISOString();
  const n = async (sql: string) => (await db.query(sql, [now])).rowCount ?? 0;
  const result: CleanupResult = {
    sessions: await n(`DELETE FROM sessions WHERE expires_at < $1`),
    tokens: await n(`DELETE FROM password_tokens WHERE expires_at < $1::timestamptz - interval '30 days'`),
    emails: await n(`DELETE FROM email_outbox WHERE status = 'sent' AND sent_at < $1::timestamptz - interval '90 days'`),
    notifications: await n(`DELETE FROM notifications WHERE read_at < $1::timestamptz - interval '180 days'`),
    problems: await n(`DELETE FROM app_problems WHERE created_at < $1::timestamptz - interval '90 days'`),
  };
  await db.query(`UPDATE app_settings SET cleanup_on = $1::date`, [clock.today]);
  return result;
}

/**
 * Item 101 (R7): trava de tarefa automática. Se um dia houver dois servidores ligados, só um roda cada tarefa
 * por vez (evita e-mail em dobro). Vale até o fim da transação.
 */
export async function jobLock(db: Db, name: string): Promise<boolean> {
  const r = await one(db, `SELECT pg_try_advisory_xact_lock(hashtext($1)) AS ok`, [`synctasks:${name}`]);
  return !!r?.ok;
}
