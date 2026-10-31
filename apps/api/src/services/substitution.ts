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
/** Substituição em vigor: não encerrada e sem ter passado do último dia. */
const ACTIVE = `s.ended_at IS NULL AND (s.ends_on IS NULL OR s.ends_on >= ${TODAY})`;
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
  endsOn: string | null;
  createdAt: string;
  createdByName: string;
}

/** A substituição em vigor de uma pessoa (quem a substitui), ou null. */
export async function current(db: Db, absentId: string): Promise<SubstitutionDto | null> {
  const r = await one(
    db,
    `SELECT s.id, s.share_common, s.ends_on, s.created_at, su.id AS sub_id, su.name AS sub_name, su.role_title AS sub_role, cb.name AS created_by_name
       FROM substitutions s JOIN users su ON su.id = s.substitute_id JOIN users cb ON cb.id = s.created_by
      WHERE s.absent_id = $1 AND su.active AND ${ACTIVE}`,
    [absentId],
  );
  if (!r) return null;
  return {
    id: r.id,
    substitute: { id: r.sub_id, name: r.sub_name, roleTitle: r.sub_role },
    shareCommon: r.share_common,
    endsOn: r.ends_on,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
  };
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

export async function start(db: Db, by: Actor, absentId: string, input: { substituteId: string; shareCommon: boolean; endsOn: string | null }) {
  const absent = await target(db, by, absentId);
  await db.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [absentId]);
  if (input.endsOn) {
    const ok = await one(db, `SELECT ($1::date >= ${TODAY}) AS ok`, [input.endsOn]);
    if (!ok?.ok) throw badRequest('A data de volta não pode estar no passado.');
  }
  const options = await candidates(db, absentId);
  const sub = options.find((o) => o.id === input.substituteId);
  if (!sub) throw badRequest('Escolha um substituto ativo.');
  const before = await current(db, absentId);
  await db.query(`UPDATE substitutions s SET ended_at = now(), ended_by = $2 WHERE s.absent_id = $1 AND s.ended_at IS NULL`, [absentId, by.id]);
  await db.query(
    `INSERT INTO substitutions (absent_id, substitute_id, share_common, ends_on, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [absentId, sub.id, input.shareCommon, input.endsOn, by.id],
  );
  const until = input.endsOn ? ` até ${input.endsOn.split('-').reverse().join('/')}` : '';
  if (before && before.substitute.id !== sub.id) {
    await notify(db, before.substitute.id, 'substitution_ended', `Você não substitui mais ${absent.name}.`);
  }
  await notify(
    db,
    sub.id,
    'substitution_started',
    `Você vai substituir ${absent.name}${until}. Para cuidar das tarefas, escolha “${absent.name}” no seletor do topo do SyncTasks.`,
  );
  if (by.id !== absentId) await notify(db, absentId, 'substitution_started', `${by.name} escolheu ${sub.name} para substituir você${until}.`);
  return current(db, absentId);
}

export async function end(db: Db, by: Actor, absentId: string) {
  const absent = await target(db, by, absentId);
  const now = await current(db, absentId);
  await db.query(`UPDATE substitutions SET ended_at = now(), ended_by = $2 WHERE absent_id = $1 AND ended_at IS NULL`, [absentId, by.id]);
  if (now) {
    await notify(db, now.substitute.id, 'substitution_ended', `A substituição de ${absent.name} terminou. Obrigado!`);
    if (by.id !== absentId) await notify(db, absentId, 'substitution_ended', `${by.name} encerrou a sua substituição por ${now.substitute.name}.`);
  }
  return { ok: true };
}
