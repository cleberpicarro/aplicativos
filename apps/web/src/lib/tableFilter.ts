/* Item 36: filtro por condições da visão em tabela (campo + operador + valor, como no Pipedrive). */

export type Field =
  | 'code' | 'title' | 'description' | 'board' | 'list' | 'status' | 'due' | 'created' | 'completed'
  | 'delegatedTo' | 'receivedFrom' | 'private' | 'archived' | 'source' | 'color';
export type Op = 'contains' | 'not_contains' | 'eq' | 'neq' | 'empty' | 'not_empty' | 'before' | 'after' | 'between' | 'last_days' | 'next_days';
export type Value = string | number | boolean | [string, string] | null;
export interface Condition { field: Field; op: Op; value?: Value }
export interface Filter { all: Condition[]; any: Condition[] }

type Kind = 'code' | 'text' | 'board' | 'list' | 'status' | 'date' | 'person' | 'bool' | 'source' | 'color';

export const FIELDS: { id: Field; label: string; kind: Kind }[] = [
  { id: 'title', label: 'Título', kind: 'text' },
  { id: 'description', label: 'Descrição', kind: 'text' },
  { id: 'code', label: 'Código', kind: 'code' },
  { id: 'board', label: 'Quadro', kind: 'board' },
  { id: 'list', label: 'Fase', kind: 'list' },
  { id: 'status', label: 'Situação', kind: 'status' },
  { id: 'due', label: 'Prazo', kind: 'date' },
  { id: 'created', label: 'Criada em', kind: 'date' },
  { id: 'completed', label: 'Concluída em', kind: 'date' },
  { id: 'delegatedTo', label: 'Delegada para', kind: 'person' },
  { id: 'receivedFrom', label: 'Recebida de', kind: 'person' },
  { id: 'private', label: 'Privada', kind: 'bool' },
  { id: 'archived', label: 'Arquivada', kind: 'bool' },
  { id: 'source', label: 'Origem', kind: 'source' },
  { id: 'color', label: 'Cor', kind: 'color' },
];

export const OPS: Record<Kind, Op[]> = {
  code: ['eq'],
  text: ['contains', 'not_contains', 'eq', 'empty', 'not_empty'],
  board: ['eq', 'neq'],
  list: ['eq', 'neq'],
  status: ['eq', 'neq'],
  date: ['before', 'after', 'eq', 'between', 'last_days', 'next_days', 'empty', 'not_empty'],
  person: ['eq', 'neq', 'not_empty', 'empty'],
  bool: ['eq'],
  source: ['eq', 'neq'],
  color: ['eq', 'neq', 'not_empty', 'empty'],
};

export const OP_LABEL: Record<Op, string> = {
  contains: 'contém', not_contains: 'não contém', eq: 'é', neq: 'não é', empty: 'está vazio', not_empty: 'não está vazio',
  before: 'antes de', after: 'depois de', between: 'entre', last_days: 'nos últimos', next_days: 'nos próximos',
};
/** Para pessoa, "vazio" se lê melhor como "ninguém" / "alguém". */
const PERSON_OP_LABEL: Partial<Record<Op, string>> = { empty: 'é ninguém', not_empty: 'é alguém' };
/** Item 38: cor do cartão. */
const COLOR_OP_LABEL: Partial<Record<Op, string>> = { empty: 'sem cor', not_empty: 'com alguma cor' };
export const COLOR_VALUES = [
  { id: 'azul', label: 'Azul' }, { id: 'verde', label: 'Verde' }, { id: 'amarelo', label: 'Amarelo' }, { id: 'laranja', label: 'Laranja' },
  { id: 'vermelho', label: 'Vermelho' }, { id: 'roxo', label: 'Roxo' }, { id: 'rosa', label: 'Rosa' }, { id: 'cinza', label: 'Cinza' },
];

export const STATUS_VALUES = [{ id: 'open', label: 'Aberta' }, { id: 'done', label: 'Concluída' }];
export const SOURCE_VALUES = [
  { id: 'manual', label: 'Criada no app' },
  { id: 'web', label: 'Capturada da web' },
  { id: 'email', label: 'Capturada do e-mail' },
  { id: 'trello', label: 'Importada do Trello' },
];

export const fieldOf = (id: Field) => FIELDS.find((f) => f.id === id)!;
export const opsFor = (id: Field) => OPS[fieldOf(id).kind];
export const opLabel = (field: Field, op: Op) =>
  (fieldOf(field).kind === 'person' && PERSON_OP_LABEL[op]) || (fieldOf(field).kind === 'color' && COLOR_OP_LABEL[op]) || OP_LABEL[op];
export const needsValue = (op: Op) => op !== 'empty' && op !== 'not_empty';

/** Valor inicial ao escolher campo e operador, para a condição já valer sem digitar nada quando possível. */
export function defaultValue(field: Field, op: Op): Value {
  if (!needsValue(op)) return null;
  const kind = fieldOf(field).kind;
  if (op === 'last_days' || op === 'next_days') return 7;
  if (op === 'between') return ['', ''];
  if (kind === 'date') return 'today';
  if (kind === 'status') return 'open';
  if (kind === 'bool') return true;
  if (kind === 'source') return 'web';
  if (kind === 'color') return 'azul';
  return '';
}

export function newCondition(field: Field = 'title'): Condition {
  const op = opsFor(field)[0];
  return { field, op, value: defaultValue(field, op) };
}

/** Condição pronta para enviar: tem tudo o que o operador pede. */
export function isComplete(c: Condition): boolean {
  if (!needsValue(c.op)) return true;
  const v = c.value;
  if (Array.isArray(v)) return !!v[0] && !!v[1];
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0;
  if (typeof v === 'boolean') return true;
  return typeof v === 'string' && v.trim() !== '';
}

/** Tira as condições incompletas antes de mandar para o servidor. */
export function cleanFilter(f: Filter): Filter {
  return { all: f.all.filter(isComplete), any: f.any.filter(isComplete) };
}

export interface Names { boards: Record<string, string>; lists: Record<string, string>; people: Record<string, string> }

const br = (d: string) => (d === 'today' ? 'hoje' : `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`);

/** Texto curto de uma condição, para a etiqueta acima da tabela: “Prazo antes de hoje”. */
export function describe(c: Condition, names: Names): string {
  const f = fieldOf(c.field);
  const head = `${f.label} ${opLabel(c.field, c.op)}`;
  if (!needsValue(c.op)) return f.kind === 'color' ? `${opLabel(c.field, c.op).replace(/^./, (m) => m.toUpperCase())}` : head;
  const v = c.value;
  if (c.op === 'between' && Array.isArray(v)) return `${f.label} entre ${br(v[0])} e ${br(v[1])}`;
  if (c.op === 'last_days' || c.op === 'next_days') return `${head} ${v} ${v === 1 ? 'dia' : 'dias'}`;
  switch (f.kind) {
    case 'date': return `${head} ${br(String(v))}`;
    case 'board': return `${head} ${names.boards[String(v)] ?? '(quadro removido)'}`;
    case 'list': return `${head} ${names.lists[String(v)] ?? '(fase removida)'}`;
    case 'person': return `${head} ${names.people[String(v)] ?? '(pessoa)'}`;
    case 'status': return `${head} ${STATUS_VALUES.find((s) => s.id === v)?.label ?? v}`;
    case 'source': return `${head} ${SOURCE_VALUES.find((s) => s.id === v)?.label ?? v}`;
    case 'bool': return `${head} ${v ? 'sim' : 'não'}`;
    case 'color': return `${head} ${(COLOR_VALUES.find((s) => s.id === v)?.label ?? String(v)).toLowerCase()}`;
    default: return `${head} “${v}”`;
  }
}

export const EMPTY: Filter = { all: [], any: [] };

/** Filtros prontos (não podem ser apagados; dá para partir deles e salvar com outro nome). */
export const READY: { id: string; name: string; filter: Filter }[] = [
  { id: 'abertas', name: 'Todas as abertas', filter: { all: [{ field: 'status', op: 'eq', value: 'open' }], any: [] } },
  { id: 'atrasadas', name: 'Atrasadas', filter: { all: [{ field: 'status', op: 'eq', value: 'open' }, { field: 'due', op: 'before', value: 'today' }], any: [] } },
  { id: 'semana', name: 'Vencem nos próximos 7 dias', filter: { all: [{ field: 'status', op: 'eq', value: 'open' }, { field: 'due', op: 'next_days', value: 7 }], any: [] } },
  { id: 'delegadas', name: 'Delegadas por mim em aberto', filter: { all: [{ field: 'status', op: 'eq', value: 'open' }, { field: 'delegatedTo', op: 'not_empty' }], any: [] } },
  { id: 'concluidas', name: 'Concluídas nos últimos 30 dias', filter: { all: [{ field: 'completed', op: 'last_days', value: 30 }], any: [] } },
];

/* ---------- colunas e planilha ---------- */

export type Column = 'code' | 'title' | 'where' | 'due' | 'status' | 'delegation' | 'checklist' | 'created' | 'completed' | 'archived' | 'private' | 'source' | 'description';
export const COLUMNS: { id: Column; label: string; sort?: string; fixed?: boolean }[] = [
  { id: 'code', label: 'Código', sort: 'code', fixed: true },
  { id: 'title', label: 'Tarefa', sort: 'title', fixed: true },
  { id: 'where', label: 'Quadro · Fase', sort: 'board' },
  { id: 'due', label: 'Prazo', sort: 'due' },
  { id: 'status', label: 'Situação', sort: 'status' },
  { id: 'delegation', label: 'Delegação', sort: 'delegation' },
  { id: 'checklist', label: 'Checklist', sort: 'checklist' },
  { id: 'created', label: 'Criada em', sort: 'created' },
  { id: 'completed', label: 'Concluída em', sort: 'completed' },
  { id: 'archived', label: 'Arquivada em' },
  { id: 'private', label: 'Privada' },
  { id: 'source', label: 'Origem' },
  { id: 'description', label: 'Descrição' },
];
export const DEFAULT_COLUMNS: Column[] = ['code', 'title', 'where', 'due', 'status', 'delegation', 'checklist', 'created'];

/** Planilha CSV no formato que o Excel em português abre direto (separador ";" e acentos preservados). */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v === null ? '' : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
}
