import { config } from '../config.js';
import { one, many, type Db } from '../lib/db.js';
import { queueEmail } from './notify.js';

/*
 * Item 46: e-mails que saem sozinhos, sem ninguém clicar em nada.
 * - Prazo amanhã (véspera) e prazo vencido (no dia seguinte ao prazo), uma vez cada, para o dono atual da tarefa aberta.
 *   Na tarefa delegada, quem delegou recebe também o de vencido.
 * - Resumo diário às 7h (Brasília), de segunda a sexta, só quando há algo para mostrar.
 * O servidor roda isto de tempos em tempos (server.ts); o que já foi enviado fica marcado e não se repete.
 */

/** Resumo diário: a partir das 7h e até o meio-dia (se o servidor reiniciar de manhã, o resumo ainda sai). */
export const DIGEST_FROM_HOUR = 7;
export const DIGEST_UNTIL_HOUR = 12;
/** No resumo, no máximo tantas tarefas por grupo; o resto vira "e mais N". */
const DIGEST_MAX = 30;

const first = (name: string) => name.split(' ')[0];
const link = (cardId: string) => `${config.appUrl}/#/tarefa/${cardId}`;
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * Delegação que ainda conta: recebida e não devolvida, cancelada ou encerrada. E a tarefa de origem de uma
 * delegação em aberto fica de fora: quem cuida dela agora é quem recebeu (quem delegou recebe só o "vencido" dela).
 */
const LIVE = `(d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED','ACKED'))
  AND NOT EXISTS (SELECT 1 FROM delegations x WHERE x.parent_card_id = c.id AND x.status NOT IN ('ACKED','CANCELED'))`;

export interface ReminderResult { eve: number; late: number; digests: number }

/** Roda uma vez. `at` é o momento "agora" (os testes passam um horário fixo). */
export async function runReminders(db: Db, at: Date = new Date()): Promise<ReminderResult> {
  const clock = await one(
    db,
    `SELECT (l)::date::text AS today, extract(hour FROM l)::int AS hour, extract(isodow FROM l)::int AS dow
       FROM (SELECT $1::timestamptz AT TIME ZONE 'America/Sao_Paulo' AS l) x`,
    [at.toISOString()],
  );
  const today: string = clock.today;
  const eve = await dueEve(db, today);
  const late = await dueLate(db, today);
  const weekday = clock.dow >= 1 && clock.dow <= 5;
  const digests = weekday && clock.hour >= DIGEST_FROM_HOUR && clock.hour < DIGEST_UNTIL_HOUR ? await dailyDigests(db, today) : 0;
  return { eve, late, digests };
}

/** Véspera: a tarefa vence amanhã. */
async function dueEve(db: Db, today: string): Promise<number> {
  const rows = await many(
    db,
    `SELECT c.id, c.num, c.title, c.due_date::text AS due, o.email, o.name, (o.active AND o.email_due) AS wants
       FROM cards c JOIN users o ON o.id = c.owner_id
       LEFT JOIN delegations d ON d.card_id = c.id
      WHERE c.completed_at IS NULL AND c.archived_at IS NULL AND c.due_date = $1::date + 1
        AND c.due_eve_sent_for IS DISTINCT FROM c.due_date AND ${LIVE}
      FOR UPDATE OF c SKIP LOCKED`,
    [today],
  );
  if (!rows.length) return 0;
  await db.query('UPDATE cards SET due_eve_sent_for = due_date WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
  let sent = 0;
  for (const r of rows) {
    if (!r.wants) continue;
    await queueEmail(db, r.email, `[#${r.num}] Prazo amanhã: ${r.title}`,
      `Olá, ${first(r.name)}.\n\nA tarefa #${r.num} vence amanhã (${br(r.due)}):\n${r.title}\n\nAbrir no SyncTasks: ${link(r.id)}\n\n${OFF_DUE}`);
    sent++;
  }
  return sent;
}

/** Vencido: o prazo foi ontem e a tarefa continua aberta. Vai para o dono e, na delegada, para quem delegou. */
async function dueLate(db: Db, today: string): Promise<number> {
  const rows = await many(
    db,
    `SELECT c.id, c.num, c.title, c.is_private, c.due_date::text AS due, o.email, o.name, (o.active AND o.email_due) AS wants,
            d.id AS d_id, du.email AS d_email, du.name AS d_name, (du.active AND du.email_due) AS d_wants,
            pc.id AS parent_id, pc.num AS parent_num
       FROM cards c JOIN users o ON o.id = c.owner_id
       LEFT JOIN delegations d ON d.card_id = c.id
       LEFT JOIN users du ON du.id = d.delegator_id
       LEFT JOIN cards pc ON pc.id = d.parent_card_id
      WHERE c.completed_at IS NULL AND c.archived_at IS NULL AND c.due_date = $1::date - 1
        AND c.due_late_sent_for IS DISTINCT FROM c.due_date AND ${LIVE}
      FOR UPDATE OF c SKIP LOCKED`,
    [today],
  );
  if (!rows.length) return 0;
  await db.query('UPDATE cards SET due_late_sent_for = due_date WHERE id = ANY($1::uuid[])', [rows.map((r) => r.id)]);
  let sent = 0;
  for (const r of rows) {
    if (r.wants) {
      await queueEmail(db, r.email, `[#${r.num}] Prazo vencido: ${r.title}`,
        `Olá, ${first(r.name)}.\n\nO prazo da tarefa #${r.num} venceu ontem (${br(r.due)}) e ela ainda está aberta:\n${r.title}\n\nAbrir no SyncTasks: ${link(r.id)}\n\n${OFF_DUE}`);
      sent++;
    }
    // Tarefa privada avisa só o dono (e tarefa delegada nunca é privada: item 43).
    if (r.d_id && r.d_wants && !r.is_private) {
      const num = r.parent_num ?? r.num;
      await queueEmail(db, r.d_email, `[#${num}] Prazo vencido: ${r.title} (com ${first(r.name)})`,
        `Olá, ${first(r.d_name)}.\n\nA tarefa que você delegou para ${r.name} venceu ontem (${br(r.due)}) e ainda está aberta:\n#${num} ${r.title}\n\nAbrir no SyncTasks: ${link(r.parent_id ?? r.id)}\n\n${OFF_DUE}`);
      sent++;
    }
  }
  return sent;
}

const OFF_DUE = 'Para não receber mais os avisos de prazo, desmarque a opção em Meus dados (clique no seu nome no SyncTasks).';
const OFF_DIGEST = 'Para não receber mais o resumo diário, desmarque a opção em Meus dados (clique no seu nome no SyncTasks).';

interface Item { id: string; num: number; title: string; due: string | null; who?: string }

/** Resumo diário de cada pessoa: vencem hoje, atrasadas, para aceitar e aguardando o seu ciente. */
async function dailyDigests(db: Db, today: string): Promise<number> {
  const users = await many(
    db,
    `SELECT id, name, email FROM users
      WHERE active AND email_digest AND level IS NOT NULL AND digest_sent_on IS DISTINCT FROM $1::date
      FOR UPDATE SKIP LOCKED`,
    [today],
  );
  let sent = 0;
  for (const u of users) {
    await db.query('UPDATE users SET digest_sent_on = $2::date WHERE id = $1', [u.id, today]);
    const own = await many<Item & { late: boolean }>(
      db,
      `SELECT c.id, c.num, c.title, c.due_date::text AS due, c.due_date < $2::date AS late
         FROM cards c LEFT JOIN delegations d ON d.card_id = c.id
        WHERE c.owner_id = $1 AND c.completed_at IS NULL AND c.archived_at IS NULL AND c.due_date <= $2::date AND ${LIVE}
          AND (d.id IS NULL OR d.status <> 'PENDING_ACCEPT')
        ORDER BY c.due_date, c.num`,
      [u.id, today],
    );
    const inbox = await many<Item>(
      db,
      `SELECT c.id, c.num, c.title, c.due_date::text AS due, du.name AS who
         FROM cards c JOIN delegations d ON d.card_id = c.id JOIN users du ON du.id = d.delegator_id
        WHERE c.owner_id = $1 AND c.list_id IS NULL AND c.archived_at IS NULL AND d.status = 'PENDING_ACCEPT'
        ORDER BY c.created_at`,
      [u.id],
    );
    const ack = await many<Item>(
      db,
      `SELECT c.id, coalesce(pc.num, c.num) AS num, c.title, c.due_date::text AS due, o.name AS who
         FROM delegations d JOIN cards c ON c.id = d.card_id JOIN users o ON o.id = c.owner_id
         LEFT JOIN cards pc ON pc.id = d.parent_card_id
        WHERE d.delegator_id = $1 AND d.status = 'AWAITING_ACK' AND c.archived_at IS NULL
        ORDER BY c.completed_at`,
      [u.id],
    );
    const dueToday = own.filter((c) => !c.late);
    const late = own.filter((c) => c.late);
    if (!dueToday.length && !late.length && !inbox.length && !ack.length) continue;

    const parts = [
      dueToday.length && `${dueToday.length} ${dueToday.length === 1 ? 'vence' : 'vencem'} hoje`,
      late.length && `${late.length} ${late.length === 1 ? 'atrasada' : 'atrasadas'}`,
      inbox.length && `${inbox.length} para aceitar`,
      ack.length && `${ack.length} ${ack.length === 1 ? 'aguarda' : 'aguardam'} seu ciente`,
    ].filter(Boolean);
    const section = (title: string, items: Item[], extra: (c: Item) => string) => {
      if (!items.length) return '';
      const lines = items.slice(0, DIGEST_MAX).map((c) => `- #${c.num} ${c.title}${extra(c)}\n  ${link(c.id)}`);
      if (items.length > DIGEST_MAX) lines.push(`- e mais ${items.length - DIGEST_MAX}`);
      return `${title}\n${lines.join('\n')}\n\n`;
    };
    const body =
      `Olá, ${first(u.name)}. Este é o seu resumo de hoje (${br(today)}) no SyncTasks.\n\n` +
      section('Vencem hoje', dueToday, () => '') +
      section('Atrasadas', late, (c) => ` (prazo ${br(c.due!)})`) +
      section('Delegadas para você, aguardando aceite na caixa de entrada', inbox, (c) => ` (de ${first(c.who!)})`) +
      section('Concluídas por quem você delegou, aguardando o seu ciente', ack, (c) => ` (${first(c.who!)})`) +
      `Abrir o SyncTasks: ${config.appUrl}\n\n${OFF_DIGEST}`;
    await queueEmail(db, u.email, `Resumo do dia: ${parts.join(', ')}`, body);
    sent++;
  }
  return sent;
}
