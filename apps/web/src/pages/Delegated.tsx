import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type Card, type Overview } from '../lib/api';
import { go, useRoute } from '../lib/router';
import { TIPS, daysBetween, firstName, plural } from '../lib/format';
import { Avatar, CardStatusIcon, Due, TipIcon, ErrorText } from '../components/ui';
import { Icon } from '../components/Icons';
import { ConfirmDialog, RedelegateDialog, ReopenDialog, useAction } from '../components/dialogs';

type Pending = null | { kind: 'reopen' | 'redelegate' | 'cancel'; card: Card };

/** Filtros que chegam do Painel (#/delegadas?filtro=...&pessoa=...). */
export const FILTERS: Record<string, { label: string; test: (c: Card, today: string) => boolean }> = {
  abertas: { label: 'Em aberto', test: (c) => isOpen(c) },
  atrasadas: { label: 'Atrasadas', test: (c, t) => isOpen(c) && !!c.dueDate && c.dueDate < t },
  semana: { label: 'Vencem em até 7 dias', test: (c, t) => isOpen(c) && !!c.dueDate && c.dueDate >= t && daysBetween(t, c.dueDate) <= 7 },
  noprazo: { label: 'No prazo', test: (c, t) => isOpen(c) && (!c.dueDate || daysBetween(t, c.dueDate) > 7) },
  ciente: { label: 'Aguardando seu ciente', test: (c) => c.delegation?.status === 'AWAITING_ACK' },
  devolvidas: { label: 'Devolvidas', test: (c) => c.delegation?.status === 'DECLINED' },
};

function isOpen(c: Card) {
  return c.delegation?.status === 'PENDING_ACCEPT' || c.delegation?.status === 'IN_PROGRESS';
}

const COLLAPSE_KEY = 'synctasks.delegadas.recolhidos';
function loadCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; }
}
function saveCollapsed(v: Record<string, boolean>) {
  try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ }
}

export function DelegatedPage() {
  const route = useRoute();
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ['delegations', archived], queryFn: () => get<Overview>(`/delegations${archived ? '?archived=1' : ''}`) });
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(loadCollapsed);
  const [pending, setPending] = useState<Pending>(null);
  const { run, busy, error } = useAction();
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
          <button className="b" title={TIPS.cancel} onClick={() => setPending({ kind: 'cancel', card: c })}>Cancelar</button>
        </>
      );
    }
    return null;
  };

  const childIcon = (c: Card) =>
    c.child && c.child.status !== 'CANCELED' ? <TipIcon name="out" tip={`Repassada para ${c.child.ownerName}`} /> : null;

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
    <div key={c.id} className="row dl">
      <CardStatusIcon card={c} />
      <div className="title">
        <button className={c.archivedAt ? 'done-t' : ''} onClick={() => go(`/tarefa/${c.code}`)} title={c.title}>{c.title}</button>
        {c.delegation?.status === 'DECLINED' && <span className="note" title={c.delegation.declineReason ?? ''}>“{c.delegation.declineReason}”</span>}
        {c.checklist.total > 0 && <span className="cl">{c.checklist.done}/{c.checklist.total}</span>}
      </div>
      <span className="person">{withPerson && <><Avatar name={c.ownerName} /><span>{c.ownerName}</span></>}</span>
      <span className="code">{c.code}</span>
      <Due date={c.dueDate} done={!!c.completedAt} today={data!.today} />
      <span className="lnk">{childIcon(c)}</span>
      <div className="acts fixed">{actions(c)}</div>
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

          <section className="blk" aria-labelledby="h-team">
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
          </section>
        </>
      )}
      {pending?.kind === 'reopen' && <ReopenDialog card={pending.card} onClose={() => setPending(null)} />}
      {pending?.kind === 'redelegate' && <RedelegateDialog card={pending.card} onClose={() => setPending(null)} />}
      {pending?.kind === 'cancel' && (
        <ConfirmDialog title="Cancelar delegação" danger confirm="Cancelar delegação"
          text={`Cancelar “${pending.card.title}”? ${firstName(pending.card.ownerName)} é avisado(a).`}
          onConfirm={() => post(`/delegations/${pending.card.delegation!.id}/cancel`)} onClose={() => setPending(null)} />
      )}
    </div>
  );
}
