import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, post, type Card, type Overview } from '../lib/api';
import { go } from '../lib/router';
import { firstName, plural } from '../lib/format';
import { Avatar, CardStatusIcon, Due, TipIcon, ErrorText } from '../components/ui';
import { Icon } from '../components/Icons';
import { ConfirmDialog, RedelegateDialog, ReopenDialog, useAction } from '../components/dialogs';

type Pending = null | { kind: 'reopen' | 'redelegate' | 'cancel'; card: Card };

export function DelegatedPage() {
  const [archived, setArchived] = useState(false);
  const q = useQuery({ queryKey: ['delegations', archived], queryFn: () => get<Overview>(`/delegations${archived ? '?archived=1' : ''}`) });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending>(null);
  const { run, busy, error } = useAction();

  const actions = (c: Card) => {
    const d = c.delegation!;
    if (c.archivedAt) return null;
    if (d.status === 'AWAITING_ACK') {
      return (
        <>
          <button className="b pri" disabled={busy} onClick={() => run(() => post(`/delegations/${d.id}/ack`), 'Ciente dado. Tarefa arquivada.')}>Dar ciente</button>
          <button className="b" onClick={() => setPending({ kind: 'reopen', card: c })}>Reabrir</button>
        </>
      );
    }
    if (d.status === 'DECLINED') {
      return (
        <>
          <button className="b pri" onClick={() => setPending({ kind: 'redelegate', card: c })}>Redelegar</button>
          <button className="b" onClick={() => setPending({ kind: 'cancel', card: c })}>Cancelar</button>
        </>
      );
    }
    return null;
  };

  const childIcon = (c: Card) =>
    c.child && c.child.status !== 'CANCELED' ? <TipIcon name="out" tip={`Repassada para ${c.child.ownerName}`} /> : null;

  const data = q.data;
  return (
    <div className="page">
      <div className="head"><div><h1>Tarefas delegadas</h1><p>O que você delegou, para quem e em que pé está.</p></div></div>
      <ErrorText error={error} />
      {q.isLoading && <p className="loading">Carregando…</p>}
      {data && (
        <>
          <section className="blk" aria-labelledby="h-need">
            <h2 id="h-need">Precisam da sua ação <span className={`c${data.needAction.length ? ' attn' : ''}`}>{data.needAction.length}</span></h2>
            {data.needAction.length === 0 ? (
              <div className="empty">Nada aguardando você. Tarefas concluídas e devolvidas aparecem aqui.</div>
            ) : (
              <div className="rows">
                {data.needAction.map((c) => (
                  <div key={c.id} className="row need">
                    <CardStatusIcon card={c} />
                    <div className="title">
                      <button onClick={() => go(`/tarefa/${c.code}`)} title={c.title}>{c.title}</button>
                      {c.delegation?.status === 'DECLINED' && <span className="note" title={c.delegation.declineReason ?? ''}>“{c.delegation.declineReason}”</span>}
                    </div>
                    <span className="person"><Avatar name={c.ownerName} /><span>{c.ownerName}</span></span>
                    <span className="code">{c.code}</span>
                    <Due date={c.dueDate} done={!!c.completedAt} today={data.today} />
                    <div className="acts">{actions(c)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="blk" aria-labelledby="h-team">
            <h2 id="h-team">Equipe</h2>
            {data.groups.length === 0 && <div className="empty">Você não tem subordinados diretos.</div>}
            <div>
              {data.groups.map((g) => {
                const open = !collapsed[g.person.id];
                const st = (n: number, one: string, many: string, cls: string) => (
                  <span className={n ? cls : 'zero'}><em>{n}</em>{plural(n, one, many)}</span>
                );
                return (
                  <div key={g.person.id} className="group">
                    <button className="ghead" aria-expanded={open} onClick={() => setCollapsed((s) => ({ ...s, [g.person.id]: open }))}>
                      <span className="car"><Icon name="car" /></span>
                      <Avatar name={g.person.name} />
                      <span className="gname"><b>{g.person.name}</b><span>{g.person.roleTitle}{!g.person.direct && ' · não é mais subordinado direto'}</span></span>
                      <span className="stats">
                        {st(g.counts.open, 'aberta', 'abertas', '')}
                        {st(g.counts.late, 'atrasada', 'atrasadas', 'late')}
                        {st(g.counts.awaitingAck, 'aguardando ciente', 'aguardando ciente', 'attn')}
                        {g.counts.declined > 0 && st(g.counts.declined, 'devolvida', 'devolvidas', 'attn')}
                        <span className="tip" data-tip="Tarefas próprias abertas, só para conhecimento" style={{ position: 'relative' }}>
                          <em>{g.counts.own}</em>{plural(g.counts.own, 'própria', 'próprias')}
                        </span>
                      </span>
                    </button>
                    {open && (
                      <>
                        {g.tasks.length > 0 && (
                          <div className="rows">
                            {g.tasks.map((c) => (
                              <div key={c.id} className="row">
                                <CardStatusIcon card={c} />
                                <div className="title">
                                  <button className={c.archivedAt ? 'done-t' : ''} onClick={() => go(`/tarefa/${c.code}`)} title={c.title}>{c.title}</button>
                                  {c.checklist.total > 0 && <span className="cl">{c.checklist.done}/{c.checklist.total}</span>}
                                </div>
                                <span className="code">{c.code}</span>
                                <Due date={c.dueDate} done={!!c.completedAt} today={data.today} />
                                <span className="lnk">{childIcon(c)}</span>
                                <div className="acts">{actions(c)}</div>
                              </div>
                            ))}
                          </div>
                        )}
                        {g.person.direct && (
                          <p className="hint">
                            {g.tasks.length === 0 ? 'Nenhuma tarefa delegada. ' : ''}Para delegar a {firstName(g.person.name)}, abra uma tarefa sua e use Delegar.
                          </p>
                        )}
                      </>
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
