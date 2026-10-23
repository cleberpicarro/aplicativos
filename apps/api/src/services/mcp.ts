import { z } from 'zod';
import { config } from '../config.js';
import { many, one, tx, type Db, type Pool } from '../lib/db.js';
import { HttpError, badRequest } from '../lib/errors.js';
import { isoDate } from '../lib/dates.js';
import type { Actor } from './actors.js';
import * as tasks from './tasks.js';
import { inbox } from './delegation.js';
import { tableRows, type Condition } from './table.js';
import { logEvent } from './events.js';

/**
 * Item 65: conector MCP (Model Context Protocol). O assistente de IA (Claude ou outro compatível)
 * chama estas ferramentas em nome da pessoa que clicou em "Permitir", com as mesmas regras do app:
 * só os quadros dela, e tarefas criadas por ela.
 */

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const MAX_TOOL_TASKS = 20;
const LIST_LIMIT = 50;

const INSTRUCTIONS =
  'SyncTasks é o app de tarefas da Nerus. Use listar_quadros para saber os quadros e fases da pessoa; ' +
  'criar_tarefas para criar tarefas (sem quadro, vão para a caixa de entrada); ver_tarefas para consultar as tarefas dela. ' +
  'Datas no formato AAAA-MM-DD, no fuso de Brasília. Antes de criar, confirme com a pessoa o que será criado.';

const TOOLS = [
  {
    name: 'listar_quadros',
    title: 'Listar quadros e fases',
    description: 'Lista os quadros da pessoa no SyncTasks, com as fases de cada um, na ordem do app.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'criar_tarefas',
    title: 'Criar tarefas',
    description:
      `Cria de 1 a ${MAX_TOOL_TASKS} tarefas no SyncTasks da pessoa, todas ou nenhuma. ` +
      'Sem "quadro", a tarefa vai para a caixa de entrada, para a pessoa organizar depois. ' +
      'Com "quadro" e sem "fase", vai para a primeira fase do quadro. Quadro e fase são achados pelo nome (sem diferenciar maiúsculas e acentos).',
    inputSchema: {
      type: 'object',
      properties: {
        tarefas: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_TOOL_TASKS,
          items: {
            type: 'object',
            properties: {
              titulo: { type: 'string', maxLength: 200, description: 'Título curto da tarefa.' },
              descricao: { type: 'string', maxLength: 20000, description: 'Detalhes (opcional).' },
              prazo: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Prazo AAAA-MM-DD (opcional).' },
              quadro: { type: 'string', description: 'Nome do quadro (opcional).' },
              fase: { type: 'string', description: 'Nome da fase dentro do quadro (opcional).' },
            },
            required: ['titulo'],
            additionalProperties: false,
          },
        },
      },
      required: ['tarefas'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: 'ver_tarefas',
    title: 'Ver minhas tarefas',
    description: `Mostra até ${LIST_LIMIT} tarefas abertas da pessoa (as privadas também, porque são dela), ordenadas pelo prazo.`,
    inputSchema: {
      type: 'object',
      properties: {
        situacao: {
          type: 'string',
          enum: ['abertas', 'atrasadas', 'hoje', 'proximos_7_dias', 'caixa_de_entrada'],
          description: 'Qual recorte (padrão: abertas).',
        },
        busca: { type: 'string', maxLength: 200, description: 'Texto que aparece no título (opcional).' },
        quadro: { type: 'string', description: 'Só deste quadro (opcional).' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

/** Para achar quadro e fase pelo nome: sem maiúsculas, sem acentos e sem espaços sobrando. */
export function norm(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Nome exato primeiro; senão, o único que contém o texto. */
function findByName<T extends { name: string }>(items: T[], wanted: string): T | undefined {
  const w = norm(wanted);
  const exact = items.filter((i) => norm(i.name) === w);
  if (exact.length) return exact[0];
  const part = items.filter((i) => norm(i.name).includes(w));
  return part.length === 1 ? part[0] : undefined;
}

interface Board { id: string; name: string; lists: { id: string; name: string }[] }

async function boardsOf(db: Db, actor: Actor): Promise<Board[]> {
  const rows = await many(
    db,
    `SELECT b.id, b.name, l.id AS list_id, l.name AS list_name FROM boards b
       LEFT JOIN lists l ON l.board_id = b.id AND l.archived_at IS NULL
      WHERE b.owner_id = $1 AND b.archived_at IS NULL ORDER BY b.position, l.position`,
    [actor.id],
  );
  const out: Board[] = [];
  for (const r of rows) {
    let b = out.find((x) => x.id === r.id);
    if (!b) out.push((b = { id: r.id, name: r.name, lists: [] }));
    if (r.list_id) b.lists.push({ id: r.list_id, name: r.list_name });
  }
  return out;
}

const names = (items: { name: string }[]) => items.map((i) => `“${i.name}”`).join(', ');

function brDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
const link = (id: string) => `${config.appUrl}/#/tarefa/${id}`;

function needHierarchy(actor: Actor) {
  if (actor.level === null) throw new HttpError(403, 'Administradores fora da hierarquia não têm quadros nem tarefas.');
}

async function listBoardsTool(pool: Pool, actor: Actor) {
  needHierarchy(actor);
  const boards = await boardsOf(pool, actor);
  if (!boards.length) return 'A pessoa ainda não tem quadros. Tarefas sem quadro vão para a caixa de entrada.';
  return [
    `Quadros de ${actor.name}:`,
    ...boards.map((b) => `- ${b.name}: ${b.lists.length ? b.lists.map((l) => l.name).join(', ') : '(sem fases)'}`),
    'Sem quadro informado, a tarefa vai para a caixa de entrada.',
  ].join('\n');
}

const createSchema = z.object({
  tarefas: z
    .array(
      z.object({
        titulo: z.string().trim().min(1, 'Toda tarefa precisa de título.').max(200),
        descricao: z.string().max(20000).optional(),
        prazo: isoDate.optional(),
        quadro: z.string().max(80).optional(),
        fase: z.string().max(60).optional(),
      }),
    )
    .min(1)
    .max(MAX_TOOL_TASKS),
});

async function createTool(pool: Pool, actor: Actor, args: unknown) {
  needHierarchy(actor);
  const parsed = createSchema.safeParse(args);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(`Dado inválido${issue?.path.length ? ` em ${issue.path.join('.')}` : ''}: ${issue?.message ?? ''}`.trim());
  }
  return tx(pool, async (db) => {
    const boards = await boardsOf(db, actor);
    const lines: string[] = [];
    for (const t of parsed.data.tarefas) {
      let where = 'Caixa de entrada';
      let card: { id: string; num: number };
      const description = (t.descricao ?? '').trim();
      if (t.quadro?.trim()) {
        const b = findByName(boards, t.quadro);
        if (!b) throw badRequest(`Quadro “${t.quadro}” não encontrado. Quadros da pessoa: ${names(boards) || 'nenhum'}.`);
        const l = t.fase?.trim() ? findByName(b.lists, t.fase) : b.lists[0];
        if (!l) throw badRequest(t.fase?.trim() ? `Fase “${t.fase}” não encontrada no quadro “${b.name}”. Fases: ${names(b.lists)}.` : `O quadro “${b.name}” não tem fases.`);
        card = await tasks.createCard(db, actor, l.id, t.titulo, description);
        where = `${b.name} › ${l.name}`;
      } else {
        // Como a captura da web: sem quadro, a tarefa espera na caixa de entrada.
        card = (await one(
          db,
          `INSERT INTO cards (owner_id, list_id, title, description, source, created_by) VALUES ($1, NULL, $2, $3, 'assistente', $1) RETURNING id, num`,
          [actor.id, t.titulo, description],
        ))!;
        await logEvent(db, card.id, actor.id, 'created', undefined, description ? { title: t.titulo, description, via: 'assistente' } : { title: t.titulo, via: 'assistente' });
      }
      await db.query(`UPDATE cards SET source = 'assistente' WHERE id = $1`, [card.id]);
      if (t.prazo) await tasks.updateCard(db, actor, card.id, { dueDate: t.prazo });
      lines.push(`- #${card.num} ${t.titulo} (${where}${t.prazo ? `, prazo ${brDate(t.prazo)}` : ''}) ${link(card.id)}`);
    }
    const n = lines.length;
    return [`${n === 1 ? 'Criada 1 tarefa' : `Criadas ${n} tarefas`} no SyncTasks de ${actor.name}:`, ...lines].join('\n');
  });
}

const listSchema = z.object({
  situacao: z.enum(['abertas', 'atrasadas', 'hoje', 'proximos_7_dias', 'caixa_de_entrada']).default('abertas'),
  busca: z.string().max(200).optional(),
  quadro: z.string().max(80).optional(),
});

async function listTool(pool: Pool, actor: Actor, args: unknown) {
  needHierarchy(actor);
  const parsed = listSchema.safeParse(args ?? {});
  if (!parsed.success) throw badRequest('Situação inválida. Use abertas, atrasadas, hoje, proximos_7_dias ou caixa_de_entrada.');
  const { situacao, busca, quadro } = parsed.data;
  let cards;
  if (situacao === 'caixa_de_entrada') {
    cards = (await inbox(pool, actor)).filter((c) => !busca?.trim() || norm(c.title).includes(norm(busca)));
  } else {
    const all: Condition[] = [{ field: 'status', op: 'eq', value: 'open' }];
    if (situacao === 'atrasadas') all.push({ field: 'due', op: 'before', value: 'today' });
    if (situacao === 'hoje') all.push({ field: 'due', op: 'eq', value: 'today' });
    if (situacao === 'proximos_7_dias') all.push({ field: 'due', op: 'next_days', value: 7 });
    if (busca?.trim()) all.push({ field: 'title', op: 'contains', value: busca.trim() });
    if (quadro?.trim()) {
      const boards = await boardsOf(pool, actor);
      const b = findByName(boards, quadro);
      if (!b) throw badRequest(`Quadro “${quadro}” não encontrado. Quadros da pessoa: ${names(boards) || 'nenhum'}.`);
      all.push({ field: 'board', op: 'eq', value: b.id });
    }
    cards = (await tableRows(pool, actor, { all, any: [] }, 'due', 'asc', 0, LIST_LIMIT + 1)).rows;
  }
  if (!cards.length) return 'Nenhuma tarefa encontrada.';
  const lines = cards.slice(0, LIST_LIMIT).map((c) => {
    const parts = [c.boardName ? `${c.boardName}${'listName' in c && c.listName ? ` › ${c.listName}` : ''}` : 'Caixa de entrada'];
    if (c.dueDate) parts.push(`prazo ${brDate(c.dueDate)}`);
    if (c.delegation) parts.push(`delegada por ${c.delegation.delegatorName}`);
    if (c.child) parts.push(`delegada para ${c.child.ownerName}`);
    if (c.isPrivate) parts.push('privada');
    return `- #${c.num} ${c.title} (${parts.join(', ')}) ${link(c.id)}`;
  });
  const more = cards.length > LIST_LIMIT ? `\nHá mais tarefas; mostrando as ${LIST_LIMIT} primeiras.` : '';
  return `${lines.join('\n')}${more}`;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };

const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Uma mensagem JSON-RPC. Notificação (sem id) não tem resposta: devolve null. */
export async function handleRpc(pool: Pool, actor: Actor, msg: Rpc) {
  if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Requisição inválida.');
  const isNotification = msg.id === undefined;
  if (isNotification) return null;
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return ok(msg.id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'synctasks', title: 'SyncTasks', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(msg.id, {});
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS });
    case 'tools/call': {
      const name = msg.params?.name;
      const args = msg.params?.arguments ?? {};
      try {
        let text: string;
        if (name === 'listar_quadros') text = await listBoardsTool(pool, actor);
        else if (name === 'criar_tarefas') text = await createTool(pool, actor, args);
        else if (name === 'ver_tarefas') text = await listTool(pool, actor, args);
        else return fail(msg.id, -32602, `Ferramenta desconhecida: ${String(name)}.`);
        return ok(msg.id, { content: [{ type: 'text', text }] });
      } catch (err) {
        // Erro de regra (quadro não encontrado, sem permissão…) volta para o assistente explicar à pessoa.
        if (err instanceof HttpError) return ok(msg.id, { content: [{ type: 'text', text: err.message }], isError: true });
        throw err;
      }
    }
    default:
      return fail(msg.id, -32601, `Método não suportado: ${msg.method}.`);
  }
}
