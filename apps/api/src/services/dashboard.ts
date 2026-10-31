import { many, type Db } from '../lib/db.js';
import type { Actor } from './actors.js';
import type { CardDto } from './cards.js';
import { delegationsOverview } from './delegation.js';

const DAY = 86_400_000;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  return new Date(d.getTime() + n * DAY).toISOString().slice(0, 10);
}

/**
 * Item 17: Painel de quem tem equipe. Usa só as tarefas que a pessoa delegou
 * (mesma visibilidade de "Tarefas delegadas").
 */
export async function dashboard(db: Db, actor: Actor) {
  const ov = await delegationsOverview(db, actor, false);
  const { today } = ov;
  const in7 = addDays(today, 7);
  const isOpen = (c: CardDto) => ['PENDING_ACCEPT', 'IN_PROGRESS'].includes(c.delegation!.status);
  const all = ov.groups.flatMap((g) => g.tasks);

  const people = ov.groups.map((g) => {
    const open = g.tasks.filter(isOpen);
    const late = open.filter((c) => c.dueDate && c.dueDate < today).length;
    const dueSoon = open.filter((c) => c.dueDate && c.dueDate >= today && c.dueDate <= in7).length;
    return {
      id: g.person.id,
      name: g.person.name,
      roleTitle: g.person.roleTitle,
      onTime: open.length - late - dueSoon,
      dueSoon,
      late,
      own: g.counts.own,
    };
  });

  const openCards = all.filter(isOpen);
  const summary = {
    open: openCards.length,
    late: openCards.filter((c) => c.dueDate && c.dueDate < today).length,
    awaitingAck: all.filter((c) => c.delegation!.status === 'AWAITING_ACK').length,
    declined: all.filter((c) => c.delegation!.status === 'DECLINED').length,
  };

  const days = Array.from({ length: 14 }, (_, i) => {
    const date = addDays(today, i);
    return { date, cards: openCards.filter((c) => c.dueDate === date) };
  });
  const overdue = openCards.filter((c) => c.dueDate && c.dueDate < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));

  // Há quanto tempo cada delegação está parada.
  const timing = await many(
    db,
    `SELECT d.card_id, d.status, d.updated_at,
            (SELECT max(e.created_at) FROM card_events e WHERE e.card_id = d.card_id) AS last_event
       FROM delegations d JOIN cards c ON c.id = d.card_id
      WHERE d.delegator_id = $1 AND c.archived_at IS NULL`,
    [actor.id],
  );
  const now = Date.now();
  const daysSince = (t: string | Date) => Math.floor((now - new Date(t).getTime()) / DAY);
  const byId = new Map(all.map((c) => [c.id, c]));
  const stalled = { notAccepted: [] as { card: CardDto; days: number }[], noMovement: [] as { card: CardDto; days: number }[], awaitingAck: [] as { card: CardDto; days: number }[] };
  for (const t of timing) {
    const card = byId.get(t.card_id);
    if (!card) continue;
    if (t.status === 'PENDING_ACCEPT' && daysSince(t.updated_at) > 2) stalled.notAccepted.push({ card, days: daysSince(t.updated_at) });
    if (t.status === 'IN_PROGRESS' && daysSince(t.last_event ?? t.updated_at) > 7) stalled.noMovement.push({ card, days: daysSince(t.last_event ?? t.updated_at) });
    if (t.status === 'AWAITING_ACK' && daysSince(t.updated_at) > 2) stalled.awaitingAck.push({ card, days: daysSince(t.updated_at) });
  }
  for (const list of Object.values(stalled)) list.sort((a, b) => b.days - a.days);

  return { today, summary, people, agenda: { overdue, days }, stalled };
}
