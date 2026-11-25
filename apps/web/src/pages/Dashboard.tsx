import { useQuery } from '@tanstack/react-query';
import { get, type Card } from '../lib/api';
import { go } from '../lib/router';
import { fullDate, plural, shortDate } from '../lib/format';
import { CardStatusIcon, Due } from '../components/ui';
import type { PersonLoad } from '../lib/dashboard';

interface Stalled { card: Card; days: number }
interface DashboardData {
  today: string;
  summary: { open: number; late: number; awaitingAck: number; declined: number };
  people: PersonLoad[];
  agenda: { overdue: Card[]; days: { date: string; cards: Card[] }[] };
  stalled: { notAccepted: Stalled[]; noMovement: Stalled[]; awaitingAck: Stalled[] };
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekday = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00`).getDay()];

/** Item 17 / item 105: os números e as listas do antigo Painel, agora dentro de Tarefas delegadas. */
export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/dashboard'), refetchInterval: 30_000 });
}
export type { DashboardData };

export function DashTiles({ d, active }: { d: DashboardData; active?: string }) {
  const tiles: { key: string; n: number; label: string; tone: '' | 'late' | 'attn' }[] = [
    { key: 'abertas', n: d.summary.open, label: 'Em aberto', tone: '' },
    { key: 'atrasadas', n: d.summary.late, label: plural(d.summary.late, 'Atrasada', 'Atrasadas'), tone: 'late' },
    { key: 'ciente', n: d.summary.awaitingAck, label: 'Aguardando seu ciente', tone: 'attn' },
    { key: 'devolvidas', n: d.summary.declined, label: plural(d.summary.declined, 'Devolvida', 'Devolvidas'), tone: 'attn' },
  ];
  return (
    <div className="tiles">
      {tiles.map((t) => (
        <button key={t.key} className={`tile-n${t.n && t.tone ? ` ${t.tone}` : ''}`} aria-pressed={active === t.key} onClick={() => go(active === t.key ? '/delegadas' : `/delegadas?filtro=${t.key}`)}>
          <b>{t.n}</b><span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

export const agendaCount = (d: DashboardData) => d.agenda.overdue.length + d.agenda.days.reduce((s, x) => s + x.cards.length, 0);
export const stalledCount = (d: DashboardData) => d.stalled.notAccepted.length + d.stalled.noMovement.length + d.stalled.awaitingAck.length;

export function AgendaBlock({ d }: { d: DashboardData }) {
  if (agendaCount(d) === 0) return <div className="empty">Nenhuma tarefa delegada vence nos próximos 14 dias.</div>;
  return (
    <div className="agenda">
      {d.agenda.overdue.length > 0 && (
        <div className="ag-day late">
          <div className="ag-date"><b>Atrasadas</b></div>
          <div>{d.agenda.overdue.map((c) => <CardLine key={c.id} card={c} today={d.today} />)}</div>
        </div>
      )}
      {d.agenda.days.filter((x) => x.cards.length > 0).map((x) => (
        <div key={x.date} className="ag-day">
          <div className="ag-date" title={fullDate(x.date)}>
            <b>{x.date === d.today ? 'Hoje' : shortDate(x.date)}</b><small>{weekday(x.date)}</small>
          </div>
          <div>{x.cards.map((c) => <CardLine key={c.id} card={c} today={d.today} />)}</div>
        </div>
      ))}
    </div>
  );
}

export function StalledBlock({ d }: { d: DashboardData }) {
  if (stalledCount(d) === 0) return <div className="empty">Nada parado. Tudo andando.</div>;
  return (
    <>
      <StalledList title="Sem aceite há mais de 2 dias" items={d.stalled.notAccepted} today={d.today} />
      <StalledList title="Sem movimento há mais de 7 dias" items={d.stalled.noMovement} today={d.today} />
      <StalledList title="Aguardando seu ciente há mais de 2 dias" items={d.stalled.awaitingAck} today={d.today} />
    </>
  );
}

function CardLine({ card, today, extra }: { card: Card; today: string; extra?: string }) {
  return (
    <button className="ag-card" onClick={() => go(`/tarefa/${card.id}`)} title={card.title}>
      <CardStatusIcon card={card} />
      <span className="t">{card.title}</span>
      <span className="o">{card.ownerName}</span>
      {extra ? <span className="d">{extra}</span> : <Due date={card.dueDate} today={today} />}
    </button>
  );
}

function StalledList({ title, items, today }: { title: string; items: Stalled[]; today: string }) {
  if (items.length === 0) return null;
  return (
    <div className="st-group">
      <h3>{title} <span>{items.length}</span></h3>
      {items.map((s) => <CardLine key={s.card.id} card={s.card} today={today} extra={`${s.days} ${plural(s.days, 'dia', 'dias')}`} />)}
    </div>
  );
}
