import type { Db } from '../lib/db.js';
import { many, one } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';

/**
 * Item 121: uso da plataforma (botão “Uso da plataforma” em Pessoas, só administração).
 * Conta as ações gravadas no log das tarefas (card_events), uma vez cada, no dia de Brasília.
 * Não contam os registros “espelho” que o log grava na tarefa de origem quando a de baixo muda
 * (senão uma delegação contaria duas vezes) nem os feitos pelo próprio sistema (sem pessoa).
 */
export const MIRROR_TYPES = ['delegated_down', 'child_resumed', 'child_canceled', 'child_cancel_undone'];

/** Grupos mostrados em “Por tipo de ação”. O que não estiver aqui cai em “Outras ações”. */
const GROUPS: [string, string[]][] = [
  ['Criar tarefas', ['created', 'captured', 'imported', 'repeat_next']],
  ['Editar (prazo, título, checklist…)', ['title_changed', 'description_changed', 'due_changed', 'priority_changed', 'privacy_changed', 'no_pass_changed', 'repeat_changed', 'checklist_added', 'checklist_edited', 'checklist_removed', 'follower_added', 'follower_removed']],
  ['Mover entre fases', ['moved']],
  ['Concluir e dar ciente', ['completed', 'completion_undone', 'acked', 'reopened', 'archived', 'unarchived', 'discarded']],
  ['Delegar e transferir', ['delegated', 'redelegated', 'transferred', 'management_transferred']],
  ['Aceitar, devolver e cobrar', ['accepted', 'declined', 'nudged', 'resumed', 'canceled', 'cancel_undone']],
  ['Comentar', ['comment_added']],
];
const groupOf = (type: string) => GROUPS.find(([, t]) => t.includes(type))?.[0] ?? 'Outras ações';

/** Até 62 dias o gráfico mostra uma barra por dia; acima disso, uma por mês. */
export const DAY_LIMIT = 62;
const MAX_DAYS = 366 * 3;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export async function usage(db: Db, from: string, to: string) {
  if (to < from) throw badRequest('A data final vem antes da inicial.');
  const span = daysBetween(from, to) + 1;
  if (span > MAX_DAYS) throw badRequest('Escolha um período de até 3 anos.');
  const unit: 'day' | 'month' = span <= DAY_LIMIT ? 'day' : 'month';

  const buckets: string[] = [];
  if (unit === 'day') for (let i = 0; i < span; i++) buckets.push(addDays(from, i));
  else {
    let y = +from.slice(0, 4), m = +from.slice(5, 7);
    const end = to.slice(0, 7);
    for (;;) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (k > end) break;
      buckets.push(`${k}-01`);
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  const index = new Map(buckets.map((b, i) => [b, i]));

  const rows = await many<{ actor_id: string; b: string; type: string; n: number }>(db,
    `SELECT e.actor_id, to_char(${unit === 'day' ? `(e.created_at AT TIME ZONE 'America/Sao_Paulo')::date` : `date_trunc('month', e.created_at AT TIME ZONE 'America/Sao_Paulo')::date`}, 'YYYY-MM-DD') AS b,
            e.type, count(*)::int AS n
       FROM card_events e
      WHERE e.actor_id IS NOT NULL
        AND e.type <> ALL($3::text[])
        AND e.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND e.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      GROUP BY 1, 2, 3`,
    [from, to, MIRROR_TYPES]);

  const users = await many<{ id: string; name: string; active: boolean; anonymized: boolean }>(db,
    `SELECT id, name, active, anonymized_at IS NOT NULL AS anonymized FROM users ORDER BY name`);
  const byUser = new Map<string, number[]>();
  const types = new Map<string, number>();
  for (const r of rows) {
    const i = index.get(r.b);
    if (i === undefined) continue;
    const s = byUser.get(r.actor_id) ?? Array(buckets.length).fill(0);
    s[i] += r.n;
    byUser.set(r.actor_id, s);
    const g = groupOf(r.type);
    types.set(g, (types.get(g) ?? 0) + r.n);
  }
  const people = users
    .filter((u) => byUser.has(u.id))
    .map((u) => { const series = byUser.get(u.id)!; return { id: u.id, name: u.name, active: u.active, series, total: series.reduce((a, b) => a + b, 0) }; })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));
  const current = users.filter((u) => u.active && !u.anonymized);
  const idle = current.filter((u) => !byUser.has(u.id)).map((u) => u.name);
  const today = (await one<{ d: string }>(db, `SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`))!.d;
  const order = [...GROUPS.map(([g]) => g), 'Outras ações'];
  return {
    from, to, today, unit, buckets,
    total: people.reduce((a, p) => a + p.total, 0),
    activeUsers: current.length,
    usedUsers: people.filter((p) => current.some((u) => u.id === p.id)).length,
    people,
    idle,
    byType: order.filter((g) => types.has(g)).map((g) => ({ group: g, n: types.get(g)! })).sort((a, b) => b.n - a.n),
  };
}
