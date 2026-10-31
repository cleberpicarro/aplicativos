import { config } from '../config.js';
import { many, one, type Db } from '../lib/db.js';
import { badRequest, conflict, forbidden } from '../lib/errors.js';
import type { Actor } from './actors.js';
import { loadCard } from './cards.js';
import { logEvent } from './events.js';
import { queueEmail } from './notify.js';

/** Item 81: só e-mails deste domínio podem seguir uma tarefa. */
export const FOLLOWER_DOMAIN = 'nerus.com.br';
export const MAX_FOLLOWERS = 20;
/** Novidades com menos de 5 minutos entre si vão num e-mail só. */
export const QUIET_MINUTES = 5;

const EMAIL = /^[^\s@]+@[^\s@]+$/;

export function normalizeFollower(input: string): string {
  const email = input.trim().toLowerCase();
  if (!EMAIL.test(email)) throw badRequest('Digite um e-mail válido.');
  if (!email.endsWith(`@${FOLLOWER_DOMAIN}`)) throw badRequest(`Só e-mails @${FOLLOWER_DOMAIN} podem seguir a tarefa.`);
  return email;
}

export async function listFollowers(db: Db, cardId: string) {
  const rows = await many(
    db,
    `SELECT f.email, u.name AS added_by_name, f.created_at FROM card_followers f JOIN users u ON u.id = f.added_by
      WHERE f.card_id = $1 ORDER BY f.created_at, f.email`,
    [cardId],
  );
  return rows.map((r) => ({ email: r.email as string, addedByName: r.added_by_name as string, createdAt: r.created_at as string }));
}

/** Quem está com a tarefa ou quem a delegou inclui e tira seguidores; a auditoria só vê. */
async function manageable(db: Db, actor: Actor, cardId: string) {
  const { row, role } = await loadCard(db, actor, cardId, { lock: true });
  if (role === 'auditor') throw forbidden('Só quem está com a tarefa ou quem a delegou muda os seguidores.');
  if (row.archived_at) throw conflict('Tarefa arquivada: desarquive para mudar os seguidores.');
  return row;
}

export async function addFollower(db: Db, actor: Actor, cardId: string, input: string) {
  const email = normalizeFollower(input);
  const row = await manageable(db, actor, cardId);
  if (row.is_private) throw conflict('Tarefa privada não pode ter seguidores.');
  const n = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM card_followers WHERE card_id = $1', [cardId]);
  if (n!.n >= MAX_FOLLOWERS) throw conflict(`A tarefa pode ter até ${MAX_FOLLOWERS} seguidores.`);
  // O primeiro e-mail do seguidor já traz o próprio registro de inclusão e o log completo da tarefa.
  const last = await one<{ m: string }>(db, 'SELECT coalesce(max(id), 0) AS m FROM card_events WHERE card_id = $1', [cardId]);
  const added = await one(
    db,
    `INSERT INTO card_followers (card_id, email, added_by, last_event_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING RETURNING email`,
    [cardId, email, actor.id, last!.m],
  );
  if (!added) throw conflict('Este e-mail já segue a tarefa.');
  await logEvent(db, cardId, actor.id, 'follower_added', undefined, { email });
  return listFollowers(db, cardId);
}

export async function removeFollower(db: Db, actor: Actor, cardId: string, input: string) {
  const email = input.trim().toLowerCase();
  await manageable(db, actor, cardId);
  const gone = await one(db, 'DELETE FROM card_followers WHERE card_id = $1 AND email = $2 RETURNING email', [cardId, email]);
  if (gone) await logEvent(db, cardId, actor.id, 'follower_removed', { email });
  return listFollowers(db, cardId);
}

/** Link "parar de seguir" do e-mail: não precisa entrar no SyncTasks. */
export async function unfollowByToken(db: Db, token: string) {
  const gone = await one(
    db,
    `DELETE FROM card_followers f USING cards c WHERE f.token = $1 AND c.id = f.card_id RETURNING f.card_id, f.email, c.title`,
    [token],
  );
  if (!gone) return null;
  await logEvent(db, gone.card_id, null, 'follower_removed', { email: gone.email }, { self: true });
  return { email: gone.email as string, title: gone.title as string };
}

/** Ao delegar, os seguidores passam também para o cartão de quem recebe. */
export async function copyFollowers(db: Db, fromCardId: string, toCardId: string) {
  await db.query(
    `INSERT INTO card_followers (card_id, email, added_by, last_event_id)
     SELECT $2, email, added_by, 0 FROM card_followers WHERE card_id = $1 ON CONFLICT DO NOTHING`,
    [fromCardId, toCardId],
  );
}

/* ---------- e-mail com o log ---------- */

interface Ev { id: string; type: string; before: any; after: any; at: string; actor_name: string | null; via_name: string | null }

const df = (v: string | null | undefined) => (v ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : 'sem prazo');
const cut = (s: string) => (s.length > 220 ? `${s.slice(0, 220)}…` : s);

/** O mesmo texto do log da tarefa aberta (describe em CardModal.tsx), para o e-mail dos seguidores. */
export function describeEvent(e: { type: string; before: any; after: any }): string {
  const a = e.after ?? {}, b = e.before ?? {};
  const t = (text: string, change?: string) => (change ? `${text}: ${change}` : text);
  switch (e.type) {
    case 'created': return t('criou a tarefa');
    case 'imported': return t(`importou a tarefa do ${a.source}`);
    case 'title_changed': return t('alterou o título', `“${b.title}” → “${a.title}”`);
    case 'description_changed': return t('alterou a descrição', `“${cut(b.description || '')}” → “${cut(a.description || '')}”`);
    case 'due_changed': return t('alterou o prazo', `${df(b.dueDate)} → ${df(a.dueDate)}`);
    case 'privacy_changed': return t(a.isPrivate ? 'tornou a tarefa privada' : 'tornou a tarefa visível');
    case 'no_pass_changed': return t(a.noPass ? 'marcou que a tarefa não pode ser repassada' : 'liberou repassar a tarefa');
    case 'moved': return a.board ? t('moveu para outro quadro', `“${b.board} · ${b.list}” → “${a.board} · ${a.list}”`) : t(`moveu de “${b.list}” para “${a.list}”`);
    case 'captured': return t(a.email ? 'capturou do e-mail' : 'capturou da web', a.url ?? undefined);
    case 'accepted': return t(`aceitou e colocou em “${a.board} · ${a.list}”`);
    case 'checklist_added': return t('adicionou item ao checklist', `“${a.text}”`);
    case 'checklist_edited': return t('editou item do checklist', `“${b.text}” → “${a.text}”`);
    case 'checklist_checked': return t('marcou item do checklist', `“${a.text}”`);
    case 'checklist_unchecked': return t('desmarcou item do checklist', `“${a.text}”`);
    case 'checklist_removed': return t('removeu item do checklist', `“${b.text}”`);
    case 'comment_added': return t('comentou', `“${cut(a.body)}”`);
    case 'delegated': return t(`delegou para ${a.to}`, `prazo sugerido ${df(a.suggestedDue)}`);
    case 'delegated_down': return t(`delegou para baixo: ${a.to}`);
    case 'declined': return t('devolveu a tarefa', `“${a.reason}”`);
    case 'completed': return t('concluiu a tarefa');
    case 'completion_undone': return t('desfez a conclusão');
    case 'archived': return t(a.undo ? 'desfez a criação (tarefa arquivada)' : 'arquivou a tarefa');
    case 'unarchived': return t('desarquivou a tarefa');
    case 'discarded': return t(a.board ? 'descartou a tarefa, sem concluir' : 'descartou a tarefa da caixa de entrada');
    case 'acked': return t('deu ciente: tarefa arquivada');
    case 'reopened': return t('reabriu a tarefa', `“${a.reason}”`);
    case 'canceled': return t('cancelou a delegação');
    case 'child_canceled': return t(a.archived ? 'cancelou a delegação devolvida e arquivou a tarefa' : 'cancelou a delegação para baixo');
    case 'resumed': return t('retomou a tarefa devolvida (delegação encerrada)');
    case 'child_resumed': return t('retomou a tarefa devolvida');
    case 'cancel_undone': return t('desfez o cancelamento da delegação');
    case 'child_cancel_undone': return t('desfez o cancelamento da delegação para baixo');
    case 'redelegated': return t(`redelegou para ${a.to}`, `prazo sugerido ${df(a.suggestedDue)}`);
    case 'transferred': return t(`transferiu de ${b.owner} para ${a.owner}`);
    case 'management_transferred': return t('transferência de gestão', `acompanhamento passou de ${b.delegator ?? '—'} para ${a.delegator}`);
    case 'follower_added': return t('incluiu um seguidor', a.email);
    case 'follower_removed': return a.self ? t('deixou de seguir a tarefa') : t('tirou um seguidor', b.email);
    default: return e.type;
  }
}

// Quem deixa de seguir pelo link do e-mail não tem conta: aparece o próprio e-mail.
const who = (e: Ev) => e.actor_name ?? (e.type === 'follower_removed' && e.before?.email ? e.before.email : 'Sistema');
const line = (e: Ev) => `• ${e.at} · ${who(e)}${e.via_name ? ` (por ${e.via_name}, substituto)` : ''} ${describeEvent(e)}`;

/**
 * Item 81: um e-mail por seguidor e tarefa quando o log tem novidades e ficou 5 minutos sem nenhuma nova.
 * Tarefa privada não manda nada: as novidades do período privado são puladas.
 */
export async function runFollowerMail(db: Db, now: Date = new Date()) {
  const pending = await many(
    db,
    `SELECT f.card_id, f.email, f.token, f.last_event_id, c.is_private, c.code, c.title, o.name AS owner_name,
            (SELECT max(e.id) FROM card_events e WHERE e.card_id = f.card_id) AS max_id
       FROM card_followers f JOIN cards c ON c.id = f.card_id JOIN users o ON o.id = c.owner_id
      WHERE EXISTS (SELECT 1 FROM card_events e WHERE e.card_id = f.card_id AND e.id > f.last_event_id)
        AND (SELECT max(e.created_at) FROM card_events e WHERE e.card_id = f.card_id AND e.id > f.last_event_id)
            <= $1::timestamptz - make_interval(mins => $2)
      FOR UPDATE OF f SKIP LOCKED`,
    [now.toISOString(), QUIET_MINUTES],
  );
  const logs = new Map<string, Ev[]>();
  let sent = 0;
  for (const p of pending) {
    if (!p.is_private) {
      if (!logs.has(p.card_id)) {
        logs.set(p.card_id, await many<Ev>(
          db,
          `SELECT e.id, e.type, e.before, e.after, to_char(e.created_at AT TIME ZONE $2, 'DD/MM/YYYY HH24:MI') AS at,
                  u.name AS actor_name, v.name AS via_name
             FROM card_events e LEFT JOIN users u ON u.id = e.actor_id LEFT JOIN users v ON v.id = e.via_user_id
            WHERE e.card_id = $1 AND e.id <= $3 ORDER BY e.created_at, e.id`,
          [p.card_id, config.timezone, p.max_id],
        ));
      }
      const log = logs.get(p.card_id)!;
      const fresh = log.filter((e) => BigInt(e.id) > BigInt(p.last_event_id));
      const subject = `[${p.code}] ${fresh.length === 1 ? describeEvent(fresh[0]).split(':')[0] : `${fresh.length} novidades`}: ${p.title}`;
      const body = [
        'Olá.',
        '',
        `Novidades na tarefa ${p.code} · ${p.title} (com ${p.owner_name}):`,
        '',
        ...fresh.map(line),
        '',
        'Log completo da tarefa:',
        '',
        ...log.map(line),
        '',
        'Você recebe este e-mail porque foi incluído(a) como seguidor(a) desta tarefa no SyncTasks.',
        `Parar de seguir: ${config.appUrl}/seguir/sair?t=${p.token}`,
        '',
      ].join('\n');
      await queueEmail(db, p.email, subject, body);
      sent++;
    }
    await db.query('UPDATE card_followers SET last_event_id = $3 WHERE card_id = $1 AND email = $2', [p.card_id, p.email, p.max_id]);
  }
  return { sent };
}
