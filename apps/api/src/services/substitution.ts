import { one, many, type Db } from '../lib/db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { toActor, type Actor } from './actors.js';
import { notify } from './notify.js';

/**
 * Item 72: substituição em férias e ausências.
 * Quem sai (ou a administração, numa saída de surpresa) escolhe um substituto. Enquanto durar, o substituto
 * troca para a pessoa no seletor do topo e gerencia os quadros, a caixa de entrada e as delegações dela:
 * privadas nunca aparecem; as tarefas comuns, só se a pessoa compartilhou (regra em actors.subSees).
 */

const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
/** Substituição em aberto: não encerrada e sem ter passado do último dia (em vigor ou agendada, item 76). */
const OPEN = `s.ended_at IS NULL AND (s.ends_on IS NULL OR s.ends_on >= ${TODAY})`;
/** Substituição em vigor: em aberto e já no primeiro dia fora (ou sem dia marcado). */
const ACTIVE = `${OPEN} AND (s.starts_on IS NULL OR s.starts_on <= ${TODAY})`;
const br = (d: string) => d.split('-').reverse().join('/');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pedido com o seletor ligado: devolve a pessoa substituída como "quem age", lembrando quem está de fato no app. */
export async function actAs(db: Db, real: Actor, absentId: string): Promise<Actor> {
  if (!UUID.test(absentId)) throw forbidden('A substituição terminou.');
  const row = await one(
    db,
    `SELECT u.*, s.share_common FROM substitutions s JOIN users u ON u.id = s.absent_id
      WHERE s.absent_id = $1 AND s.substitute_id = $2 AND u.active AND ${ACTIVE}`,
    [absentId, real.id],
  );
  if (!row) throw forbidden('A substituição terminou.');
  // Nada de administração em nome de outra pessoa: o substituto age só como alguém da hierarquia.
  return { ...toActor(row), isAdmin: false, sub: { id: real.id, name: real.name, share: row.share_common } };
}

export interface SubstitutionDto {
  id: string;
  substitute: { id: string; name: string; roleTitle: string };
  shareCommon: boolean;
  /** Item 76: primeiro dia fora (null = começou ao ser criada). */
  startsOn: string | null;
  endsOn: string | null;
  /** Item 76: 'scheduled' = ainda não chegou o primeiro dia fora. */
  status: 'active' | 'scheduled';
  createdAt: string;
  createdByName: string;
}

const DTO_SQL = `SELECT s.id, s.share_common, s.starts_on, s.ends_on, s.created_at, s.created_by, s.absent_id,
            (s.starts_on IS NOT NULL AND s.starts_on > ${TODAY}) AS scheduled,
            su.id AS sub_id, su.name AS sub_name, su.role_title AS sub_role, cb.name AS created_by_name
       FROM substitutions s JOIN users su ON su.id = s.substitute_id JOIN users cb ON cb.id = s.created_by`;

function toDto(r: any): SubstitutionDto {
  return {
    id: r.id,
    substitute: { id: r.sub_id, name: r.sub_name, roleTitle: r.sub_role },
    shareCommon: r.share_common,
    startsOn: r.starts_on,
    endsOn: r.ends_on,
    status: r.scheduled ? 'scheduled' : 'active',
    createdAt: r.created_at,
    createdByName: r.created_by_name,
  };
}

/** A substituição em aberto de uma pessoa (em vigor ou agendada), ou null. */
export async function current(db: Db, absentId: string): Promise<SubstitutionDto | null> {
  const r = await one(db, `${DTO_SQL} WHERE s.absent_id = $1 AND su.active AND ${OPEN}`, [absentId]);
  return r ? toDto(r) : null;
}

/** Quem esta pessoa está substituindo agora (as opções do seletor do topo). */
export async function covering(db: Db, substituteId: string) {
  const rows = await many(
    db,
    `SELECT u.id, u.name, u.role_title, s.share_common, s.ends_on
       FROM substitutions s JOIN users u ON u.id = s.absent_id
      WHERE s.substitute_id = $1 AND u.active AND ${ACTIVE} ORDER BY u.name`,
    [substituteId],
  );
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, roleTitle: r.role_title as string, shareCommon: r.share_common as boolean, endsOn: r.ends_on as string | null }));
}

/**
 * Quem pode substituir (item 73): qualquer pessoa ativa, menos a própria. Inclui a equipe da pessoa e quem
 * também está ausente (marcado como `absent`, para a tela avisar).
 */
export async function candidates(db: Db, absentId: string) {
  return many(
    db,
    `SELECT u.id, u.name, u.role_title AS "roleTitle", u.level,
            EXISTS (SELECT 1 FROM substitutions s WHERE s.absent_id = u.id AND ${ACTIVE}) AS absent
       FROM users u
      WHERE u.active AND u.id <> $1
      ORDER BY u.level NULLS LAST, u.name`,
    [absentId],
  );
}

/** Quem pode mexer na substituição de `absentId`: a própria pessoa ou a administração. */
async function target(db: Db, by: Actor, absentId: string) {
  if (absentId !== by.id && !by.isAdmin) throw forbidden();
  const u = await one(db, 'SELECT id, name, level, active FROM users WHERE id = $1', [absentId]);
  if (!u || !u.active) throw notFound('Pessoa não encontrada.');
  if (u.level === null) throw badRequest('Só quem está na hierarquia tem tarefas para alguém substituir.');
  return u as { id: string; name: string };
}

export async function overview(db: Db, by: Actor, absentId: string) {
  await target(db, by, absentId);
  const [now, options, today] = await Promise.all([
    current(db, absentId),
    candidates(db, absentId),
    one<{ d: string }>(db, `SELECT ${TODAY} AS d`),
  ]);
  return { current: now, candidates: options, today: today!.d };
}

export async function start(
  db: Db,
  by: Actor,
  absentId: string,
  input: { substituteId: string; shareCommon: boolean; endsOn: string | null; startsOn?: string | null },
) {
  const absent = await target(db, by, absentId);
  await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [absentId]);
  const { d: today } = (await one<{ d: string }>(db, `SELECT ${TODAY}::text AS d`))!;
  if (input.endsOn && input.endsOn < today) throw badRequest('A data de volta não pode estar no passado.');
  // Item 76: primeiro dia fora no futuro = agendada; hoje, no passado ou vazio = começa agora.
  const startsOn = input.startsOn && input.startsOn > today ? input.startsOn : null;
  if (startsOn && input.endsOn && input.endsOn < startsOn) throw badRequest('O último dia fora não pode ser antes do primeiro.');
  const options = await candidates(db, absentId);
  const sub = options.find((o) => o.id === input.substituteId);
  if (!sub) throw badRequest('Escolha um substituto ativo.');
  const before = await current(db, absentId);
  await db.query(`UPDATE substitutions s SET ended_at = now(), ended_by = $2 WHERE s.absent_id = $1 AND s.ended_at IS NULL`, [absentId, by.id]);
  await db.query(
    `INSERT INTO substitutions (absent_id, substitute_id, share_common, starts_on, ends_on, created_by, start_notified_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $4::date IS NULL THEN now() END)`,
    [absentId, sub.id, input.shareCommon, startsOn, input.endsOn, by.id],
  );
  const from = startsOn ? ` a partir de ${br(startsOn)}` : '';
  const until = input.endsOn ? ` até ${br(input.endsOn)}` : '';
  if (before && before.substitute.id !== sub.id) {
    await notify(db, before.substitute.id, 'substitution_ended', `Você não substitui mais ${absent.name}.`);
  }
  await notify(
    db,
    sub.id,
    'substitution_started',
    startsOn
      ? `Você vai substituir ${absent.name}${from}${until}. Nesse dia, escolha “${absent.name}” no seletor do topo do SyncTasks para cuidar das tarefas.`
      : `Você vai substituir ${absent.name}${until}. Para cuidar das tarefas, escolha “${absent.name}” no seletor do topo do SyncTasks.`,
  );
  if (by.id !== absentId) await notify(db, absentId, 'substitution_started', `${by.name} escolheu ${sub.name} para substituir você${from}${until}.`);
  return current(db, absentId);
}

export async function end(db: Db, by: Actor, absentId: string) {
  const absent = await target(db, by, absentId);
  const now = await current(db, absentId);
  await db.query(`UPDATE substitutions SET ended_at = now(), ended_by = $2 WHERE absent_id = $1 AND ended_at IS NULL`, [absentId, by.id]);
  if (now && now.status === 'scheduled') {
    await notify(db, now.substitute.id, 'substitution_ended', `A substituição de ${absent.name} agendada para ${br(now.startsOn!)} foi cancelada.`);
    if (by.id !== absentId) await notify(db, absentId, 'substitution_ended', `${by.name} cancelou a sua substituição agendada por ${now.substitute.name}.`);
  } else if (now) {
    await notify(db, now.substitute.id, 'substitution_ended', `A substituição de ${absent.name} terminou. Obrigado!`);
    if (by.id !== absentId) await notify(db, absentId, 'substitution_ended', `${by.name} encerrou a sua substituição por ${now.substitute.name}.`);
  }
  return { ok: true };
}

/**
 * Item 76: substituições agendadas que começam hoje. Avisa o substituto (e quem saiu) uma vez.
 * Roda junto das tarefas diárias do servidor.
 */
export async function runScheduledStarts(db: Db) {
  const rows = await many(
    db,
    `UPDATE substitutions s SET start_notified_at = now()
      FROM users a, users su
     WHERE a.id = s.absent_id AND su.id = s.substitute_id AND a.active AND su.active
       AND s.start_notified_at IS NULL AND ${ACTIVE}
     RETURNING s.absent_id, s.substitute_id, s.ends_on, a.name AS absent_name, su.name AS sub_name`,
  );
  for (const r of rows) {
    const until = r.ends_on ? ` até ${br(r.ends_on)}` : '';
    await notify(db, r.substitute_id, 'substitution_started', `Começou hoje a sua substituição de ${r.absent_name}${until}. Para cuidar das tarefas, escolha “${r.absent_name}” no seletor do topo do SyncTasks.`);
    await notify(db, r.absent_id, 'substitution_started', `Começou hoje a sua substituição por ${r.sub_name}${until}. Boas férias!`);
  }
  return rows.length;
}

/**
 * Item 76: quadro “Férias e ausências” em Pessoas (só administração): as substituições em vigor e agendadas
 * e o histórico das encerradas (as 50 mais recentes).
 */
export async function adminList(db: Db, by: Actor) {
  if (!by.isAdmin) throw forbidden();
  const rows = await many(
    db,
    `SELECT s.id, s.share_common, s.starts_on, s.ends_on, s.created_at, s.ended_at,
            (s.starts_on IS NOT NULL AND s.starts_on > ${TODAY}) AS scheduled,
            ${OPEN} AS open,
            a.id AS absent_id, a.name AS absent_name, a.role_title AS absent_role,
            su.id AS sub_id, su.name AS sub_name, su.role_title AS sub_role,
            cb.id AS created_by_id, cb.name AS created_by_name, eb.name AS ended_by_name
       FROM substitutions s
       JOIN users a ON a.id = s.absent_id JOIN users su ON su.id = s.substitute_id
       JOIN users cb ON cb.id = s.created_by LEFT JOIN users eb ON eb.id = s.ended_by
      ORDER BY (${OPEN}) DESC, COALESCE(s.starts_on, s.created_at::date), s.created_at DESC`,
  );
  const map = (r: any) => ({
    id: r.id as string,
    absent: { id: r.absent_id as string, name: r.absent_name as string, roleTitle: r.absent_role as string },
    substitute: { id: r.sub_id as string, name: r.sub_name as string, roleTitle: r.sub_role as string },
    shareCommon: r.share_common as boolean,
    startsOn: r.starts_on as string | null,
    endsOn: r.ends_on as string | null,
    status: (r.open ? (r.scheduled ? 'scheduled' : 'active') : 'ended') as 'active' | 'scheduled' | 'ended',
    createdAt: r.created_at as string,
    createdByName: r.created_by_name as string,
    bySelf: r.created_by_id === r.absent_id,
    endedAt: r.ended_at as string | null,
    endedByName: r.ended_by_name as string | null,
  });
  const today = (await one<{ d: string }>(db, `SELECT ${TODAY}::text AS d`))!.d;
  return {
    today,
    open: rows.filter((r) => r.open).map(map),
    history: rows.filter((r) => !r.open).slice(0, 50).map(map),
  };
}
