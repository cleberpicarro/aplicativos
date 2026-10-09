import { z } from 'zod';
import { one, many, type Db } from '../lib/db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isoDate } from '../lib/dates.js';
import type { Actor } from './actors.js';
import { CARD_SELECT, parseCode, toCardDto } from './cards.js';
import { NOT_UNDONE } from './archived.js';

/*
 * Item 36: visão em tabela com filtro por condições, como no Pipedrive.
 * O filtro chega como dados (campo, operador, valor) e cada condição vira um pedaço de SQL fixo daqui,
 * com os valores sempre como parâmetros: nada do que a pessoa digita entra no texto da consulta.
 */

export const TABLE_PAGE = 100;
export const TABLE_MAX = 5000;
export const MAX_SAVED_FILTERS = 50;

const TODAY = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;

const TEXT_OPS = ['contains', 'not_contains', 'eq', 'empty', 'not_empty'] as const;
const DATE_OPS = ['eq', 'before', 'after', 'between', 'last_days', 'next_days', 'empty', 'not_empty'] as const;
const PICK_OPS = ['eq', 'neq'] as const;
const PERSON_OPS = ['eq', 'neq', 'empty', 'not_empty'] as const;

/** Operadores aceitos em cada campo. */
export const FIELD_OPS = {
  code: ['eq'],
  title: TEXT_OPS,
  description: TEXT_OPS,
  board: PICK_OPS,
  list: PICK_OPS,
  status: PICK_OPS,
  due: DATE_OPS,
  created: DATE_OPS,
  completed: DATE_OPS,
  delegatedTo: PERSON_OPS,
  receivedFrom: PERSON_OPS,
  private: ['eq'],
  archived: ['eq'],
  source: PICK_OPS,
} as const satisfies Record<string, readonly string[]>;

export type Field = keyof typeof FIELD_OPS;
const FIELDS = Object.keys(FIELD_OPS) as [Field, ...Field[]];
const ALL_OPS = [...new Set(Object.values(FIELD_OPS).flat())] as [string, ...string[]];

const dateValue = z.union([z.literal('today'), isoDate]);
const value = z.union([z.string().max(200), z.number().int().min(0).max(3650), z.boolean(), z.tuple([dateValue, dateValue])]).nullable().optional();

export const conditionSchema = z
  .object({ field: z.enum(FIELDS), op: z.enum(ALL_OPS), value })
  .refine((c) => (FIELD_OPS[c.field] as readonly string[]).includes(c.op), 'Operador inválido para este campo.');

export const filterSchema = z.object({
  all: z.array(conditionSchema).max(20).default([]),
  any: z.array(conditionSchema).max(20).default([]),
});
export type Filter = z.infer<typeof filterSchema>;
export type Condition = z.infer<typeof conditionSchema>;

export const SORTS = {
  code: 'c.seq',
  title: 'lower(c.title)',
  board: 'b.position, l.position',
  due: 'c.due_date',
  status: '(c.completed_at IS NOT NULL)',
  delegation: 'coalesce(cho.name, du.name)',
  checklist: 'cl_total',
  created: 'c.created_at',
  completed: 'c.completed_at',
} as const;
export type SortKey = keyof typeof SORTS;

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Sql {
  params: unknown[] = [];
  p(v: unknown) {
    this.params.push(v);
    return `$${this.params.length}`;
  }
}

function str(c: Condition): string {
  if (typeof c.value !== 'string' || !c.value.trim()) throw badRequest('Preencha o valor de cada condição do filtro.');
  return c.value.trim();
}
function id(c: Condition): string {
  const v = str(c);
  if (!uuidRe.test(v)) throw badRequest('Valor inválido no filtro.');
  return v;
}
function days(c: Condition): number {
  if (typeof c.value !== 'number') throw badRequest('Informe o número de dias.');
  return c.value;
}
function dateSql(sql: Sql, v: unknown): string {
  const d = dateValue.safeParse(v);
  if (!d.success) throw badRequest('Informe uma data válida no filtro.');
  return d.data === 'today' ? TODAY : `${sql.p(d.data)}::date`;
}

function textCond(sql: Sql, col: string, c: Condition): string {
  switch (c.op) {
    case 'empty': return `${col} = ''`;
    case 'not_empty': return `${col} <> ''`;
    case 'eq': return `lower(${col}) = lower(${sql.p(str(c))})`;
  }
  const like = `${col} ILIKE '%' || ${sql.p(str(c).replace(/[%_\\]/g, (m) => '\\' + m))} || '%'`;
  return c.op === 'contains' ? like : `NOT (${like})`;
}

function dateCond(sql: Sql, col: string, c: Condition): string {
  switch (c.op) {
    case 'empty': return `${col} IS NULL`;
    case 'not_empty': return `${col} IS NOT NULL`;
    case 'eq': return `${col} = ${dateSql(sql, c.value)}`;
    case 'before': return `${col} < ${dateSql(sql, c.value)}`;
    case 'after': return `${col} > ${dateSql(sql, c.value)}`;
    case 'between': {
      if (!Array.isArray(c.value)) throw badRequest('Informe as duas datas.');
      return `${col} BETWEEN ${dateSql(sql, c.value[0])} AND ${dateSql(sql, c.value[1])}`;
    }
    case 'last_days': return `${col} BETWEEN ${TODAY} - ${sql.p(days(c))}::int AND ${TODAY}`;
    case 'next_days': return `${col} BETWEEN ${TODAY} AND ${TODAY} + ${sql.p(days(c))}::int`;
  }
  throw badRequest('Operador inválido.');
}

function personCond(sql: Sql, col: string, present: string, c: Condition): string {
  switch (c.op) {
    case 'empty': return `${present} IS NULL`;
    case 'not_empty': return `${present} IS NOT NULL`;
    case 'eq': return `${col} = ${sql.p(id(c))}::uuid`;
    default: return `${col} IS DISTINCT FROM ${sql.p(id(c))}::uuid`;
  }
}

function pick(sql: Sql, col: string, c: Condition, cast = ''): string {
  const v = `${sql.p(c.field === 'board' || c.field === 'list' ? id(c) : str(c))}${cast}`;
  return c.op === 'eq' ? `${col} = ${v}` : `${col} IS DISTINCT FROM ${v}`;
}

export function conditionSql(sql: Sql, c: Condition): string {
  switch (c.field) {
    case 'code': {
      const seq = parseCode(str(c));
      return seq === null ? 'false' : `c.seq = ${sql.p(seq)}`;
    }
    case 'title': return textCond(sql, 'c.title', c);
    case 'description': return textCond(sql, 'c.description', c);
    case 'board': return pick(sql, 'l.board_id', c, '::uuid');
    case 'list': return pick(sql, 'c.list_id', c, '::uuid');
    case 'status': {
      const v = str(c);
      if (v !== 'open' && v !== 'done') throw badRequest('Situação inválida.');
      const done = (v === 'done') === (c.op === 'eq');
      return done ? 'c.completed_at IS NOT NULL' : 'c.completed_at IS NULL';
    }
    case 'due': return dateCond(sql, 'c.due_date', c);
    case 'created': return dateCond(sql, `(c.created_at AT TIME ZONE 'America/Sao_Paulo')::date`, c);
    case 'completed': return dateCond(sql, `(c.completed_at AT TIME ZONE 'America/Sao_Paulo')::date`, c);
    case 'delegatedTo': return personCond(sql, 'chc.owner_id', 'ch.id', c);
    case 'receivedFrom': return personCond(sql, 'd.delegator_id', 'd.id', c);
    case 'private':
    case 'archived': {
      if (typeof c.value !== 'boolean') throw badRequest('Escolha sim ou não.');
      const col = c.field === 'private' ? 'c.is_private' : '(c.archived_at IS NOT NULL)';
      return `${col} = ${sql.p(c.value)}`;
    }
    case 'source': {
      const v = str(c);
      if (!['manual', 'web', 'email', 'trello'].includes(v)) throw badRequest('Origem inválida.');
      const col = `coalesce(c.source, 'manual')`;
      return c.op === 'eq' ? `${col} = ${sql.p(v)}` : `${col} <> ${sql.p(v)}`;
    }
  }
}

/** Monta o WHERE: só as tarefas da própria pessoa, como nos quadros e na caixa de entrada. */
export function whereFor(actor: Actor, filter: Filter) {
  const sql = new Sql();
  const parts = [
    `c.owner_id = ${sql.p(actor.id)}`,
    `(d.id IS NULL OR d.status NOT IN ('DECLINED','CANCELED'))`,
    NOT_UNDONE,
  ];
  const usesArchived = [...filter.all, ...filter.any].some((c) => c.field === 'archived');
  // Sem condição sobre "Arquivada", a tabela mostra só as que estão nos quadros e na caixa de entrada.
  if (!usesArchived) parts.push('c.archived_at IS NULL');
  for (const c of filter.all) parts.push(`(${conditionSql(sql, c)})`);
  if (filter.any.length) parts.push(`(${filter.any.map((c) => `(${conditionSql(sql, c)})`).join(' OR ')})`);
  return { where: parts.join(' AND '), params: sql.params };
}

export async function tableRows(db: Db, actor: Actor, filter: Filter, sort: SortKey, dir: 'asc' | 'desc', offset: number, limit: number) {
  const { where, params } = whereFor(actor, filter);
  const from = `${CARD_SELECT.replace('SELECT c.*, l.board_id,', 'SELECT c.*, l.board_id, b.name AS board_name, l.name AS list_name,')}
    LEFT JOIN boards b ON b.id = l.board_id`;
  const nulls = dir === 'asc' ? 'NULLS LAST' : 'NULLS FIRST';
  const order = [...SORTS[sort].split(', '), 'c.seq'].map((col) => `${col} ${dir.toUpperCase()} ${nulls}`).join(', ');
  const total = (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM cards c
    LEFT JOIN lists l ON l.id = c.list_id
    LEFT JOIN delegations d ON d.card_id = c.id
    LEFT JOIN LATERAL (SELECT * FROM delegations x WHERE x.parent_card_id = c.id AND x.status <> 'CANCELED' ORDER BY x.created_at DESC LIMIT 1) ch ON true
    LEFT JOIN cards chc ON chc.id = ch.card_id
    WHERE ${where}`, params))!.n;
  const rows = await many(db, `${from} WHERE ${where} ORDER BY ${order} LIMIT ${Math.trunc(limit)} OFFSET ${Math.trunc(offset)}`, params);
  return {
    total,
    rows: rows.map((r) => ({
      ...toCardDto(r),
      boardName: r.board_name ?? null,
      listName: r.list_name ?? null,
    })),
  };
}

/** O que a tela oferece como valor das condições: os quadros e fases da pessoa e quem já trocou tarefas com ela. */
export async function tableOptions(db: Db, actor: Actor) {
  const boards = await many(db, 'SELECT id, name FROM boards WHERE owner_id = $1 AND archived_at IS NULL ORDER BY position', [actor.id]);
  const lists = await many(
    db,
    `SELECT l.id, l.name, l.board_id FROM lists l JOIN boards b ON b.id = l.board_id
      WHERE b.owner_id = $1 AND b.archived_at IS NULL AND l.archived_at IS NULL ORDER BY b.position, l.position`,
    [actor.id],
  );
  const delegatedTo = await many(
    db,
    `SELECT DISTINCT u.id, u.name FROM delegations x JOIN cards pc ON pc.id = x.parent_card_id
       JOIN cards xc ON xc.id = x.card_id JOIN users u ON u.id = xc.owner_id
      WHERE pc.owner_id = $1
     UNION SELECT id, name FROM users WHERE manager_id = $1 AND active
     ORDER BY name`,
    [actor.id],
  );
  const receivedFrom = await many(
    db,
    `SELECT DISTINCT u.id, u.name FROM delegations x JOIN cards xc ON xc.id = x.card_id JOIN users u ON u.id = x.delegator_id
      WHERE xc.owner_id = $1
     UNION SELECT u.id, u.name FROM users u JOIN users me ON me.manager_id = u.id WHERE me.id = $1
     ORDER BY name`,
    [actor.id],
  );
  return {
    boards: boards.map((b) => ({ id: b.id, name: b.name, lists: lists.filter((l) => l.board_id === b.id).map((l) => ({ id: l.id, name: l.name })) })),
    delegatedTo,
    receivedFrom,
  };
}

/* ---------- filtros salvos (só da própria pessoa) ---------- */

export async function listFilters(db: Db, actor: Actor) {
  return many(db, 'SELECT id, name, filter FROM saved_filters WHERE owner_id = $1 ORDER BY lower(name), created_at', [actor.id]);
}

function cleanName(name: string) {
  const n = name.trim();
  if (!n) throw badRequest('Dê um nome ao filtro.');
  return n;
}

export async function createFilter(db: Db, actor: Actor, name: string, filter: Filter) {
  const n = (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM saved_filters WHERE owner_id = $1', [actor.id]))!.n;
  if (n >= MAX_SAVED_FILTERS) throw badRequest(`Você já tem ${MAX_SAVED_FILTERS} filtros salvos. Exclua algum antes de criar outro.`);
  whereFor(actor, filter); // recusa já na hora um filtro com valor inválido
  return one(db, 'INSERT INTO saved_filters (owner_id, name, filter) VALUES ($1, $2, $3) RETURNING id, name, filter', [actor.id, cleanName(name), JSON.stringify(filter)]);
}

export async function updateFilter(db: Db, actor: Actor, filterId: string, patch: { name?: string; filter?: Filter }) {
  const f = await one(db, 'SELECT id FROM saved_filters WHERE id = $1 AND owner_id = $2 FOR UPDATE', [filterId, actor.id]);
  if (!f) throw notFound('Filtro não encontrado.');
  if (patch.name !== undefined) await db.query('UPDATE saved_filters SET name = $2, updated_at = now() WHERE id = $1', [filterId, cleanName(patch.name)]);
  if (patch.filter !== undefined) {
    whereFor(actor, patch.filter);
    await db.query('UPDATE saved_filters SET filter = $2, updated_at = now() WHERE id = $1', [filterId, JSON.stringify(patch.filter)]);
  }
  return one(db, 'SELECT id, name, filter FROM saved_filters WHERE id = $1', [filterId]);
}

export async function deleteFilter(db: Db, actor: Actor, filterId: string) {
  const r = await db.query('DELETE FROM saved_filters WHERE id = $1 AND owner_id = $2', [filterId, actor.id]);
  if (!r.rowCount) throw notFound('Filtro não encontrado.');
}
