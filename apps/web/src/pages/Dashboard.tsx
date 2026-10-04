import { useQuery } from '@tanstack/react-query';
import { get, type Card } from '../lib/api';
import { go } from '../lib/router';
import { fullDate, plural, shortDate } from '../lib/format';
import { Avatar, CardStatusIcon, Due } from '../components/ui';

interface Stalled { card: Card; days: number }
interface DashboardData {
  today: string;
  summary: { open: number; late: number; awaitingAck: number; declined: number };
  people: { id: string; name: string; roleTitle: string; onTime: number; dueSoon: number; late: number; own: number }[];
  agenda: { overdue: Card[]; days: { date: string; cards: Card[] }[] };
  stalled: { notAccepted: Stalled[]; noMovement: Stalled[]; awaitingAck: Stalled[] };
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const weekday = (d: string) => WEEKDAYS[new Date(`${d}T12:00:00`).getDay()];

/** Abre "Tarefas delegadas" já filtrada. */
const open = (filtro: string, pessoa?: string) => go(`/delegadas?filtro=${filtro}${pessoa ? `&pessoa=${pessoa}` : ''}`);

/** Item 17: visão geral das tarefas que a pessoa delegou. */
export function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<DashboardData>('/dashboard') });
  if (q.isLoading) return <div className="page"><p className="loading">Carregando…</p></div>;
  const d = q.data;
  if (!d) return <div className="page"><p className="err">Não foi possível carregar o painel.</p></div>;

  const tiles: { key: string; n: number; label: string; tone: '' | 'late' | 'attn' }[] = [
    { key: 'abertas', n: d.summary.open, label: 'Em aberto', tone: '' },
    { key: 'atrasadas', n: d.summary.late, label: plural(d.summary.late, 'Atrasada', 'Atrasadas'), tone: 'late' },
    { key: 'ciente', n: d.summary.awaitingAck, label: 'Aguardando seu ciente', tone: 'attn' },
    { key: 'devolvidas', n: d.summary.declined, label: plural(d.summary.declined, 'Devolvida', 'Devolvidas'), tone: 'attn' },
  ];
  const max = Math.max(1, ...d.people.map((p) => p.onTime + p.dueSoon + p.late));
  const stalledTotal = d.stalled.notAccepted.length + d.stalled.noMovement.length + d.stalled.awaitingAck.length;
  const agendaCount = d.agenda.overdue.length + d.agenda.days.reduce((s, x) => s + x.cards.length, 0);

  return (
    <div className="page dash">
      <div className="tiles">
        {tiles.map((t) => (
          <button key={t.key} className={`tile-n${t.n && t.tone ? ` ${t.tone}` : ''}`} onClick={() => open(t.key)}>
            <b>{t.n}</b><span>{t.label}</span>
          </button>
        ))}
      </div>

      <section className="blk" aria-labelledby="h-load">
        <h2 id="h-load">Carga por pessoa</h2>
        <div className="legend" aria-hidden="true">
          <span><i className="sw s0" />No prazo ou sem prazo</span>
          <span><i className="sw s1" />Vence em até 7 dias</span>
          <span><i className="sw s2" />Atrasadas</span>
        </div>
        {d.people.length === 0 ? (
          <div className="empty">Você não tem subordinados diretos.</div>
        ) : (
          <div className="load">
            {d.people.map((p) => {
              const total = p.onTime + p.dueSoon + p.late;
              const seg = (n: number, cls: string, filtro: string, label: string) =>
                n > 0 && (
                  <button className={`seg-b ${cls}`} style={{ flexGrow: n }} data-tip={`${p.name}: ${n} ${label}`}
                    aria-label={`${n} ${label}`} onClick={() => open(filtro, p.id)} />
                );
              return (
                <div key={p.id} className="load-row">
                  <button className="who-b" onClick={() => open('abertas', p.id)} title={`Ver as tarefas abertas de ${p.name}`}>
                    <Avatar name={p.name} /><span><b>{p.name}</b><small>{p.roleTitle}</small></span>
                  </button>
                  <div className="bar-track">
                    {total > 0 && (
                      <div className="bar" style={{ width: `${(total / max) * 100}%` }}>
                        {seg(p.onTime, 's0', 'noprazo', 'no prazo ou sem prazo')}
                        {seg(p.dueSoon, 's1', 'semana', plural(p.dueSoon, 'vence em até 7 dias', 'vencem em até 7 dias'))}
                        {seg(p.late, 's2', 'atrasadas', plural(p.late, 'atrasada', 'atrasadas'))}
                      </div>
                    )}
                  </div>
                  <span className="load-n">
                    <b>{total}</b> {plural(total, 'aberta', 'abertas')}
                    {p.late > 0 && <em className="late"> · {p.late} {plural(p.late, 'atrasada', 'atrasadas')}</em>}
                  </span>
                  <span className="load-own" title="Tarefas próprias abertas, só para conhecimento">{p.own} {plural(p.own, 'própria', 'próprias')}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="dash-cols">
        <section className="blk" aria-labelledby="h-agenda">
          <h2 id="h-agenda">Próximos 14 dias <span className="c">{agendaCount}</span></h2>
          {agendaCount === 0 ? (
            <div className="empty">Nenhuma tarefa delegada vence nos próximos 14 dias.</div>
          ) : (
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
          )}
        </section>

        <section className="blk" aria-labelledby="h-stalled">
          <h2 id="h-stalled">Paradas <span className={`c${stalledTotal ? ' attn' : ''}`}>{stalledTotal}</span></h2>
          {stalledTotal === 0 ? (
            <div className="empty">Nada parado. Tudo andando.</div>
          ) : (
            <>
              <StalledList title="Sem aceite há mais de 2 dias" items={d.stalled.notAccepted} today={d.today} />
              <StalledList title="Sem movimento há mais de 7 dias" items={d.stalled.noMovement} today={d.today} />
              <StalledList title="Aguardando seu ciente há mais de 2 dias" items={d.stalled.awaitingAck} today={d.today} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function CardLine({ card, today, extra }: { card: Card; today: string; extra?: string }) {
  return (
    <button className="ag-card" onClick={() => go(`/tarefa/${card.code}`)} title={card.title}>
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
