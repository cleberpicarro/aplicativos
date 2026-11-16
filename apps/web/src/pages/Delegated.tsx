import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type Card, type Overview } from '../lib/api';
import { go, useRoute } from '../lib/router';
import { TIPS, cardNo, daysBetween, dueTone, firstName, nudgeLine, plural } from '../lib/format';
import { Avatar, CardStatusIcon, Due, TipIcon, ErrorText } from '../components/ui';
import { Icon } from '../components/Icons';
import { AgendaBlock, DashTiles, StalledBlock, agendaCount, stalledCount, useDashboard } from './Dashboard';
import { ConfirmDialog, NudgeDialog, RedelegateDialog, ReopenDialog, useAction, useCancelDelegation, useResume } from '../components/dialogs';

type Pending = null | { kind: 'reopen' | 'redelegate' | 'cancel' | 'nudge'; card: Card };

/** Filtros que chegam do Painel (#/delegadas?filtro=...&pessoa=...). */
export const FILTERS: Record<string, { label: string; test: (c: Card, today: string) => boolean }> = {
  abertas: { label: 'Em aberto', test: (c) => isOpen(c) },
  atrasadas: { label: 'Atrasadas', test: (c, t) => isOpen(c) && !!c.dueDate && c.dueDate < t },
  semana: { label: 'Vencem em até 7 dias', test: (c, t) => isOpen(c) && !!c.dueDate && c.dueDate >= t && daysBetween(t, c.dueDate) <= 7 },
  emdia: { label: 'No prazo ou sem data', test: (c, t) => isOpen(c) && (!c.dueDate || c.dueDate >= t) },
  noprazo: { label: 'No prazo', test: (c, t) => isOpen(c) && (!c.dueDate || daysBetween(t, c.dueDate) > 7) },
  ciente: { label: 'Aguardando seu ciente', test: (c) => c.delegation?.status === 'AWAITING_ACK' },
  devolvidas: { label: 'Devolvidas', test: (c) => c.delegation?.status === 'DECLINED' },
};

function isOpen(c: Card) {
  return c.delegation?.status === 'PENDING_ACCEPT' || c.delegation?.status === 'IN_PROGRESS';
}

const COLLAPSE_KEY = 'synctasks.delegadas.recolhidos';
/** Item 105: aba escolhida (Por pessoa, Próximos 14 dias, Paradas), lembrada neste navegador. */
type Tab = 'pessoas' | 'agenda' | 'paradas';
const TAB_KEY = 'synctasks.delegadas.aba';
function loadTab(): Tab {
  try { const v = localStorage.getItem(TAB_KEY); return v === 'agenda' || v === 'paradas' ? v : 'pessoas'; } catch { return 'pessoas'; }
}
/** Item 106: o que já está em "Precisam da sua ação" não repete os botões na lista da pessoa. */
const needsMe = (c: Card) => !c.archivedAt && (c.delegation?.status === 'AWAITING_ACK' || c.delegation?.status === 'DECLINED');
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; }
}
function saveCollapsed(v: Record<string, boolean>) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ }
}

export function DelegatedPage() {
  const route = useRoute();
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ['delegations', archived], queryFn: () => get<Overview>(`/delegations${archived ? '?archived=1' : ''}`), refetchInterval: 30_000 });
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(loadCollapsed);
  const [pending, setPending] = useState<Pending>(null);
  const dash = useDashboard();
  const [tab, setTabState] = useState<Tab>(loadTab);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* só não lembra */ } };
  const { run, busy, error } = useAction();
  const cancelDelegation = useCancelDelegation();
  const resume = useResume();
  const setCollapsed = (v: Record<string, boolean>) => { setCollapsedState(v); saveCollapsed(v); };

  const filterKey = route.params.get('filtro') ?? '';
  const filter = FILTERS[filterKey];
  const personFilter = route.params.get('pessoa');

  const actions = (c: Card) => {
    const d = c.delegation!;
    if (c.archivedAt) return null;
    if (d.status === 'AWAITING_ACK') {
      return (
        <>
          <button className="b pri" title={TIPS.ack} disabled={busy} onClick={() => run(() => post(`/delegations/${d.id}/ack`), 'Ciente dado. Tarefa arquivada.')}>Dar ciente</button>
          <button className="b" title={TIPS.reopen} onClick={() => setPending({ kind: 'reopen', card: c })}>Reabrir</button>
        </>
      );
    }
    if (d.status === 'DECLINED') {
      return (
        <>
          <button className="b pri" title={TIPS.redelegate} onClick={() => setPending({ kind: 'redelegate', card: c })}>Redelegar</button>
          {/* Item 75: as três saídas da devolvida. */}
          <button className="b" title={TIPS.resume} onClick={() => resume(d.id)}>Retomar</button>
          <button className="b" title={TIPS.cancelDeclined} onClick={() => setPending({ kind: 'cancel', card: c })}>Cancelar</button>
        </>
      );
    }
    if (isOpen(c)) {
      // Itens 90 e 93: cobrar, retomar (ficar com a tarefa) ou cancelar (desistir) a delegação em aberto.
      return (
        <>
          <button className="b" title={TIPS.nudge} onClick={() => setPending({ kind: 'nudge', card: c })}><Icon name="bell" />Cobrar</button>
          <button className="b" title={TIPS.resumeOpen} onClick={() => resume(d.id)}>Retomar</button>
          <button className="b" title={TIPS.cancelOpen} onClick={() => setPending({ kind: 'cancel', card: c })}>Cancelar</button>
        </>
      );
    }
    return null;
  };

  const childIcon = (c: Card) =>
    c.child && c.child.status !== 'CANCELED' ? <TipIcon name="out" tip={`Delegada para ${c.child.ownerName}`} /> : null;

  const data = q.data;
  const pass = (c: Card) => (!filter || filter.test(c, data!.today)) && (!personFilter || c.ownerId === personFilter);
  const groups = data
    ? data.groups
        .filter((g) => !personFilter || g.person.id === personFilter)
        .map((g) => ({ ...g, tasks: g.tasks.filter(pass) }))
        .filter((g) => !filter || g.tasks.length > 0)
    : [];
  const needAction = data ? data.needAction.filter(pass) : [];
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed[g.person.id]);
  const personName = personFilter ? data?.groups.find((g) => g.person.id === personFilter)?.person.name : null;

  const row = (c: Card, withPerson: boolean) => (
    <div key={c.id} className={`row dl${dueTone(c, data!.today)}`}>
      <CardStatusIcon card={c} />
      <div className="title">
        <button className={c.archivedAt ? 'done-t' : ''} onClick={() => go(`/tarefa/${c.id}`)} title={c.title}>{c.title}</button>
        {c.delegation?.status === 'DECLINED' && <span className="note" title={c.delegation.declineReason ?? ''}>“{c.delegation.declineReason}”</span>}
        {c.checklist.total > 0 && <span className="cl">{c.checklist.done}/{c.checklist.total}</span>}
        {c.delegation?.nudgedAt && isOpen(c) && (
          <span className="nudged" title={nudgeLine(c.delegation.nudgedAt, c.delegation.nudgeCount)}><Icon name="bell" />{c.delegation.nudgeCount > 1 ? `${c.delegation.nudgeCount}×` : ''}</span>
        )}
      </div>
      <span className="person">{withPerson && <><Avatar name={c.ownerName} /><span>{c.ownerName}</span></>}</span>
      <span className="code" title="Número da tarefa no seu quadro">{cardNo(c.delegation?.parentNum ?? c.num)}</span>
      <Due date={c.dueDate} done={!!c.completedAt} today={data!.today} />
      <span className="lnk">{childIcon(c)}</span>
      <div className="acts fixed">
        {!withPerson && needsMe(c) && !filter
          ? <span className="need-tag" title="Os botões estão em “Precisam da sua ação”, no alto">Precisa da sua ação</span>
          : actions(c)}
      </div>
    </div>
  );

  return (
    <div className="page">
      <ErrorText error={error} />
      {(filter || personFilter) && (
        <div className="filterbar">
          <span>Mostrando: <b>{[filter?.label, personName].filter(Boolean).join(' · ')}</b></span>
          <button className="b sm" onClick={() => go('/delegadas')}><Icon name="x" />Limpar filtro</button>
        </div>
      )}
      {dash.data && <DashTiles d={dash.data} active={filterKey} />}
      {q.isLoading && <p className="loading">Carregando…</p>}
      {data && (
        <>
          <section className="blk" aria-labelledby="h-need">
            <h2 id="h-need">Precisam da sua ação <span className={`c${needAction.length ? ' attn' : ''}`}>{needAction.length}</span></h2>
            {needAction.length === 0 ? (
              <div className="empty">Nada aguardando você. Tarefas concluídas e devolvidas aparecem aqui.</div>
            ) : (
              <div className="rows">{needAction.map((c) => row(c, true))}</div>
            )}
          </section>

          <div className="dl-tabs" role="tablist" aria-label="Ver as delegadas">
            <button role="tab" aria-selected={tab === 'pessoas'} onClick={() => setTab('pessoas')}>Por pessoa</button>
            <button role="tab" aria-selected={tab === 'agenda'} onClick={() => setTab('agenda')}>Próximos 14 dias{dash.data && <span className="c">{agendaCount(dash.data)}</span>}</button>
            <button role="tab" aria-selected={tab === 'paradas'} onClick={() => setTab('paradas')}>Paradas{dash.data && <span className={`c${stalledCount(dash.data) ? ' attn' : ''}`}>{stalledCount(dash.data)}</span>}</button>
          </div>
          {tab === 'agenda' && <section className="blk" aria-label="Próximos 14 dias">{dash.data ? <AgendaBlock d={dash.data} /> : <p className="loading">Carregando…</p>}</section>}
          {tab === 'paradas' && <section className="blk" aria-label="Paradas">{dash.data ? <StalledBlock d={dash.data} /> : <p className="loading">Carregando…</p>}</section>}
          {tab === 'pessoas' && <section className="blk" aria-labelledby="h-team">
            <div className="sec-head">
              <h2 id="h-team">Equipe</h2>
              {groups.length > 0 && (
                <button className="b ghost sm" onClick={() => setCollapsed(Object.fromEntries(groups.map((g) => [g.person.id, !allCollapsed])))}>
                  <Icon name="car" />{allCollapsed ? 'Expandir tudo' : 'Recolher tudo'}
                </button>
              )}
            </div>
            {groups.length === 0 && <div className="empty">{filter || personFilter ? 'Nenhuma tarefa com este filtro.' : 'Você não tem subordinados diretos.'}</div>}
            <div>
              {groups.map((g) => {
                const open = !collapsed[g.person.id];
                const st = (n: number, one: string, many: string, cls: string, w: string) => (
                  <span className={`stat ${n ? cls : 'zero'}`} style={{ width: w }}><em>{n}</em>{plural(n, one, many)}</span>
                );
                return (
                  <div key={g.person.id} className="group">
                    <button className="ghead" aria-expanded={open} onClick={() => setCollapsed({ ...collapsed, [g.person.id]: open })}>
                      <span className="car"><Icon name="car" /></span>
                      <Avatar name={g.person.name} large />
                      <span className="gname"><b>{g.person.name}</b><span>{g.person.roleTitle}{!g.person.direct && ' · não é mais subordinado direto'}</span></span>
                      <span className="stats">
                        {st(g.counts.open, 'aberta', 'abertas', '', '5.6rem')}
                        {st(g.counts.late, 'atrasada', 'atrasadas', 'late', '6.6rem')}
                        {st(g.counts.awaitingAck, 'aguardando ciente', 'aguardando ciente', 'attn', '9.6rem')}
                        {st(g.counts.declined, 'devolvida', 'devolvidas', 'attn', '6.8rem')}
                        <span className="stat tip" data-tip="Tarefas próprias abertas, só para conhecimento" style={{ width: '5.6rem' }}>
                          <em>{g.counts.own}</em>{plural(g.counts.own, 'própria', 'próprias')}
                        </span>
                      </span>
                    </button>
                    {open && (
                      <div className="gbody">
                        {g.tasks.length > 0 && <div className="rows">{g.tasks.map((c) => row(c, false))}</div>}
                        {g.person.direct && !filter && (
                          <p className="hint">
                            {g.tasks.length === 0 ? 'Nenhuma tarefa delegada. ' : ''}Para delegar a {firstName(g.person.name)}, abra uma tarefa sua e use Delegar.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <label className="check" style={{ marginTop: 12, padding: '0 8px' }}>
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              <span className="muted">Mostrar arquivadas e canceladas</span>
            </label>
          </section>}
        </>
      )}
      {pending?.kind === 'reopen' && <ReopenDialog card={pending.card} onClose={() => setPending(null)} />}
      {pending?.kind === 'nudge' && (
        <NudgeDialog delegationId={pending.card.delegation!.id} num={pending.card.delegation!.parentNum ?? pending.card.num} title={pending.card.title}
          ownerName={pending.card.ownerName} nudgedAt={pending.card.delegation!.nudgedAt} nudgeCount={pending.card.delegation!.nudgeCount} onClose={() => setPending(null)} />
      )}
      {pending?.kind === 'redelegate' && <RedelegateDialog card={pending.card} onClose={() => setPending(null)} />}
      {pending?.kind === 'cancel' && (
        <ConfirmDialog title="Cancelar delegação" danger confirm="Cancelar delegação"
          text={pending.card.delegation!.status === 'DECLINED'
            ? `Cancelar “${pending.card.title}”? A delegação é encerrada e a sua tarefa vai para Arquivadas.`
            : `Desistir de “${pending.card.title}”? ${firstName(pending.card.ownerName)} é avisado(a), a tarefa sai do quadro dessa pessoa e a sua vai para Arquivadas. Para ficar com ela, use Retomar.`}
          onConfirm={() => cancelDelegation(pending.card.delegation!.id, pending.card.ownerName, pending.card.delegation!.status === 'DECLINED')} onClose={() => setPending(null)} />
      )}
    </div>
  );
}
