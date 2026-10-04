import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { del, get, patch, post, type CardDetail } from '../lib/api';
import { TIPS, dateTime, delegationKey, firstName, fullDate, relative, statusOf } from '../lib/format';
import { Avatar, Dialog, ErrorText, StatusPill, useMe, useToast } from './ui';
import { Icon } from './Icons';
import { AcceptDialog, ConfirmDialog, DeclineDialog, DelegateDialog, RedelegateDialog, ReopenDialog, TransferDialog, useAction } from './dialogs';
import { go } from '../lib/router';

type Sub = null | 'delegate' | 'transfer' | 'decline' | 'reopen' | 'redelegate' | 'accept' | 'cancel';

export function CardModal({ code, onClose }: { code: string; onClose: () => void }) {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['card', code], queryFn: () => get<CardDetail>(`/cards/by-code/${code}`), retry: false });
  const [tab, setTab] = useState<'details' | 'log'>('details');
  const [sub, setSub] = useState<Sub>(null);
  const { run, busy, error } = useAction();
  const toast = useToast();

  if (q.isLoading) return <Dialog title="Carregando…" onClose={onClose} wide><p className="loading">Carregando a tarefa…</p></Dialog>;
  if (q.error || !q.data) {
    return (
      <Dialog title="Tarefa não encontrada" onClose={onClose}>
        <p style={{ margin: 0 }}>Não há uma tarefa {code} que você possa ver.</p>
      </Dialog>
    );
  }
  const { card, role, board, checklistItems, comments, canSeeLog } = q.data;
  const d = card.delegation;
  const owner = role === 'owner';
  const archived = !!card.archivedAt;
  const status = statusOf(card);
  const reports = me.directReports.length > 0;
  const childOpen = card.child && !['ACKED', 'CANCELED'].includes(card.child.status);

  const toggleDone = () =>
    run(
      () => post(`/cards/${card.id}/${card.completedAt ? 'uncomplete' : 'complete'}`),
      card.completedAt ? 'Conclusão desfeita.' : d ? `Concluída. ${firstName(d.delegatorName)} foi avisado(a) para dar o ciente.` : 'Tarefa concluída.',
    );

  const ownerActions = owner && !archived && (
    <>
      {card.inInbox ? (
        <>
          <button className="b pri" title={TIPS.accept} onClick={() => setSub('accept')}>Aceitar e organizar</button>
          {d && !card.transferredFrom && <button className="b" title={TIPS.decline} onClick={() => setSub('decline')}>Devolver</button>}
        </>
      ) : (
        <>
          <button className={`b ${card.completedAt ? '' : 'pri'}`} title={card.completedAt ? TIPS.uncomplete : TIPS.complete} onClick={toggleDone} disabled={busy}>
            <Icon name="check" />{card.completedAt ? 'Desfazer conclusão' : 'Concluir'}
          </button>
          {reports && !childOpen && !card.completedAt && (
            <button className="b" title={TIPS.delegate} onClick={() => setSub('delegate')}><Icon name="out" />Delegar</button>
          )}
          {!card.completedAt && <button className="b" title={TIPS.transfer} onClick={() => setSub('transfer')}><Icon name="move" />Transferir</button>}
          {d && d.status === 'IN_PROGRESS' && !card.transferredFrom && (
            <button className="b" title={TIPS.decline} onClick={() => setSub('decline')}><Icon name="undo" />Devolver</button>
          )}
        </>
      )}
    </>
  );

  const delegatorActions = role === 'delegator' && d && !archived && (
    <>
      {d.status === 'AWAITING_ACK' && (
        <>
          <button className="b pri" title={TIPS.ack} disabled={busy} onClick={() => run(() => post(`/delegations/${d.id}/ack`), 'Ciente dado. Tarefa arquivada.')}>Dar ciente</button>
          <button className="b" title={TIPS.reopen} onClick={() => setSub('reopen')}>Reabrir</button>
        </>
      )}
      {d.status === 'DECLINED' && <button className="b pri" title={TIPS.redelegate} onClick={() => setSub('redelegate')}>Redelegar</button>}
      {['PENDING_ACCEPT', 'IN_PROGRESS', 'DECLINED'].includes(d.status) && (
        <button className="b danger" title={TIPS.cancel} onClick={() => setSub('cancel')}>Cancelar delegação</button>
      )}
    </>
  );

  return (
    <>
      <Dialog
        wide
        onClose={onClose}
        label={`Tarefa ${card.code}`}
        title={
          <span className="meta-line" style={{ color: 'inherit' }}>
            <span className="code">{card.code}</span>
            <StatusPill status={status} />
            {card.isPrivate && <span className="pill"><Icon name="lock" />Privada</span>}
          </span>
        }
      >
        {owner && !archived ? <TitleEditor id={card.id} title={card.title} /> : <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{card.title}</div>}

        {canSeeLog && (
          <div className="subtabs" role="tablist">
            <button role="tab" aria-selected={tab === 'details'} onClick={() => setTab('details')}>Detalhes</button>
            <button role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Log</button>
          </div>
        )}

        {tab === 'log' && canSeeLog ? (
          <EventLog cardId={card.id} />
        ) : (
          <div className="card-grid">
            <div style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
              <div className="meta-line">
                <span>Com <b style={{ fontWeight: 500, color: 'var(--fg)' }}>{owner ? 'você' : card.ownerName}</b></span>
                {d && <span>· Delegada por {d.delegatorId === me.user.id ? 'você' : d.delegatorName}</span>}
                {card.transferredFrom && <span>· Transferida por {card.transferredFrom.name}</span>}
                {card.source === 'web' && <span>· Capturada da web</span>}
                {card.source === 'trello' && <span>· Importada do Trello</span>}
                {d?.parentCode && <span>· Desdobramento de <span className="code">{d.parentCode}</span></span>}
              </div>

              {d?.status === 'DECLINED' && (
                <div className="box attn"><b style={{ fontWeight: 500 }}>Justificativa da devolução:</b> “{d.declineReason}”</div>
              )}
              {card.child && (
                <div className="box">
                  <div className="meta-line" style={{ color: 'inherit' }}>
                    <Icon name="out" />
                    <span>Repassada para <b style={{ fontWeight: 500 }}>{card.child.ownerName}</b></span>
                    <span className="code">{card.child.code}</span>
                    <StatusPill status={delegationKey(card.child.status, card.child.reopened)} />
                  </div>
                  {owner && <button className="link" style={{ marginTop: 6 }} onClick={() => go(`/tarefa/${card.child!.code}`)}>Abrir a tarefa repassada</button>}
                </div>
              )}

              <Description id={card.id} text={card.description} editable={owner && !archived} />
              <Checklist cardId={card.id} items={checklistItems} editable={owner && !archived} />
              <Comments cardId={card.id} comments={comments} canPost={!archived && role !== 'auditor'} />
            </div>

            <aside className="card-side">
              <div className="field">
                <span className="label">Prazo</span>
                {owner && !archived ? <DueEditor id={card.id} value={card.dueDate} /> : <span>{card.dueDate ? fullDate(card.dueDate) : 'Sem prazo'}</span>}
                {d?.suggestedDue && d.suggestedDue !== card.dueDate && <span className="hint">Sugerido: {fullDate(d.suggestedDue)}</span>}
                {owner && d && <span className="hint">Ao mudar, {firstName(d.delegatorName)} é avisado(a).</span>}
              </div>
              {owner && board && !archived && card.listId && <MoveTo cardId={card.id} boardId={board.id} listId={card.listId} />}
              {owner && !d && !archived && (
                <label className="check">
                  <input type="checkbox" checked={card.isPrivate}
                    onChange={(e) => run(() => patch(`/cards/${card.id}`, { isPrivate: e.target.checked }), e.target.checked ? 'Tarefa privada: nenhum superior vê.' : 'Tarefa visível.')} />
                  Privada
                </label>
              )}
              {(ownerActions || delegatorActions) && <div style={{ display: 'grid', gap: 6 }}>{ownerActions}{delegatorActions}</div>}
              {role === 'auditor' && <p className="hint">Você está vendo esta tarefa pelo acesso de auditoria.</p>}
              {archived && <p className="hint">{card.delegation?.status === 'CANCELED' ? 'Delegação cancelada.' : 'Tarefa arquivada.'}</p>}
              <ErrorText error={error} />
            </aside>
          </div>
        )}
      </Dialog>

      {sub === 'delegate' && <DelegateDialog card={card} onClose={() => setSub(null)} />}
      {sub === 'transfer' && <TransferDialog card={card} onClose={() => { setSub(null); onClose(); }} />}
      {sub === 'decline' && <DeclineDialog card={card} onClose={() => { setSub(null); onClose(); }} />}
      {sub === 'reopen' && <ReopenDialog card={card} onClose={() => setSub(null)} />}
      {sub === 'redelegate' && <RedelegateDialog card={card} onClose={() => setSub(null)} />}
      {sub === 'accept' && <AcceptDialog card={card} onClose={() => setSub(null)} />}
      {sub === 'cancel' && (
        <ConfirmDialog title="Cancelar delegação" danger confirm="Cancelar delegação"
          text={`Cancelar “${card.title}”? ${firstName(card.ownerName)} é avisado(a) e a tarefa sai do quadro dessa pessoa.`}
          onConfirm={async () => { const r = await post(`/delegations/${d!.id}/cancel`); toast('Delegação cancelada.'); return r; }}
          onClose={() => setSub(null)} />
      )}
    </>
  );
}

function TitleEditor({ id, title }: { id: string; title: string }) {
  const [v, setV] = useState(title);
  const { run } = useAction();
  useEffect(() => setV(title), [title]);
  const save = () => {
    if (v.trim() && v.trim() !== title) run(() => patch(`/cards/${id}`, { title: v.trim() }));
    else setV(title);
  };
  return (
    <input className="title-input" aria-label="Título" value={v} maxLength={200} onChange={(e) => setV(e.target.value)} onBlur={save}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function Description({ id, text, editable }: { id: string; text: string; editable: boolean }) {
  const [v, setV] = useState(text);
  const { run } = useAction();
  useEffect(() => setV(text), [text]);
  if (!editable) return text ? <div><span className="label">Descrição</span><p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{text}</p></div> : null;
  return (
    <div className="field">
      <label htmlFor="c-desc">Descrição</label>
      <textarea id="c-desc" className="textarea" value={v} onChange={(e) => setV(e.target.value)} placeholder="Detalhes, contexto, links…"
        onBlur={() => { if (v !== text) run(() => patch(`/cards/${id}`, { description: v }), 'Descrição salva.'); }} />
    </div>
  );
}

function DueEditor({ id, value }: { id: string; value: string | null }) {
  const { run } = useAction();
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input type="date" className="input" aria-label="Prazo" value={value ?? ''}
        onChange={(e) => run(() => patch(`/cards/${id}`, { dueDate: e.target.value || null }), 'Prazo atualizado.')} />
      {value && <button className="b ghost icon" aria-label="Remover prazo" onClick={() => run(() => patch(`/cards/${id}`, { dueDate: null }), 'Prazo removido.')}><Icon name="x" /></button>}
    </div>
  );
}

function Checklist({ cardId, items, editable }: { cardId: string; items: CardDetail['checklistItems']; editable: boolean }) {
  const { run, error } = useAction();
  const [text, setText] = useState('');
  if (!editable && !items.length) return null;
  const done = items.filter((i) => i.done).length;
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (await run(() => post(`/cards/${cardId}/checklist`, { text }))) setText('');
  };
  return (
    <div className="field">
      <span className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Checklist</span>{items.length > 0 && <span className="cl">{done}/{items.length}</span>}
      </span>
      {items.length > 0 && <div className="progress" aria-hidden="true"><i style={{ width: `${(done / items.length) * 100}%` }} /></div>}
      <div className="checklist">
        {items.map((i) => (
          <div key={i.id} className={`it${i.done ? ' done' : ''}`}>
            <input type="checkbox" checked={i.done} disabled={!editable} aria-label={i.text}
              onChange={(e) => run(() => patch(`/cards/${cardId}/checklist/${i.id}`, { done: e.target.checked }))} />
            <span>{i.text}</span>
            {editable && <button className="b ghost icon sm x" aria-label={`Remover “${i.text}”`} onClick={() => run(() => del(`/cards/${cardId}/checklist/${i.id}`))}><Icon name="x" /></button>}
          </div>
        ))}
      </div>
      {editable && (
        <form onSubmit={add} style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Adicionar item" aria-label="Novo item do checklist" maxLength={300} />
          <button className="b" type="submit">Adicionar</button>
        </form>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function Comments({ cardId, comments, canPost }: { cardId: string; comments: CardDetail['comments']; canPost: boolean }) {
  const { run, busy, error } = useAction();
  const [body, setBody] = useState('');
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    if (await run(() => post(`/cards/${cardId}/comments`, { body }))) setBody('');
  };
  return (
    <div className="field">
      <span className="label">Comentários</span>
      {comments.length === 0 && <p className="hint">Nenhum comentário.</p>}
      <div className="comments">
        {comments.map((c) => (
          <div key={c.id} className="cmt">
            <Avatar name={c.authorName} />
            <div>
              <div className="who2"><b>{c.authorName}</b> · <time title={dateTime(c.createdAt)}>{relative(c.createdAt)}</time></div>
              <p>{c.body}</p>
            </div>
          </div>
        ))}
      </div>
      {canPost && (
        <form onSubmit={send} style={{ display: 'grid', gap: 6 }}>
          <textarea className="textarea" style={{ minHeight: '3.2rem' }} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva um comentário" aria-label="Novo comentário" />
          <div><button className="b" type="submit" disabled={busy || !body.trim()}><Icon name="comment" />Comentar</button></div>
        </form>
      )}
      <ErrorText error={error} />
    </div>
  );
}

/* ---------- log ---------- */
interface Ev { id: number; type: string; before: any; after: any; created_at: string; actor_name: string | null }

const df = (v: string | null | undefined) => (v ? fullDate(v) : 'sem prazo');
const cut = (s: string) => (s.length > 220 ? `${s.slice(0, 220)}…` : s);

function describe(e: Ev): { text: string; change?: string } {
  const a = e.after ?? {}, b = e.before ?? {};
  switch (e.type) {
    case 'created': return { text: 'criou a tarefa' };
    case 'imported': return { text: `importou a tarefa do ${a.source}`, change: `Quadro “${a.board}” · lista “${a.list}”` };
    case 'title_changed': return { text: 'alterou o título', change: `“${b.title}” → “${a.title}”` };
    case 'description_changed': return { text: 'alterou a descrição', change: `“${cut(b.description || '')}” → “${cut(a.description || '')}”` };
    case 'due_changed': return { text: 'alterou o prazo', change: `${df(b.dueDate)} → ${df(a.dueDate)}` };
    case 'privacy_changed': return { text: a.isPrivate ? 'tornou a tarefa privada' : 'tornou a tarefa visível' };
    case 'moved': return a.board ? { text: `moveu para outro quadro`, change: `“${b.board} · ${b.list}” → “${a.board} · ${a.list}”` } : { text: `moveu de “${b.list}” para “${a.list}”` };
    case 'captured': return { text: 'capturou da web', change: a.url ?? undefined };
    case 'accepted': return { text: `aceitou e colocou em “${a.board} · ${a.list}”` };
    case 'checklist_added': return { text: 'adicionou item ao checklist', change: `“${a.text}”` };
    case 'checklist_edited': return { text: 'editou item do checklist', change: `“${b.text}” → “${a.text}”` };
    case 'checklist_checked': return { text: 'marcou item do checklist', change: `“${a.text}”` };
    case 'checklist_unchecked': return { text: 'desmarcou item do checklist', change: `“${a.text}”` };
    case 'checklist_removed': return { text: 'removeu item do checklist', change: `“${b.text}”` };
    case 'comment_added': return { text: 'comentou', change: `“${cut(a.body)}”` };
    case 'delegated': return { text: `delegou para ${a.to}`, change: `Prazo sugerido: ${df(a.suggestedDue)}${a.parentCode ? ` · origem ${a.parentCode}` : ''}` };
    case 'delegated_down': return { text: `delegou para baixo: ${a.to}`, change: a.childCode };
    case 'declined': return { text: 'devolveu a tarefa', change: `“${a.reason}”` };
    case 'completed': return { text: 'concluiu a tarefa' };
    case 'completion_undone': return { text: 'desfez a conclusão' };
    case 'acked': return { text: 'deu ciente: tarefa arquivada' };
    case 'reopened': return { text: 'reabriu a tarefa', change: `“${a.reason}”` };
    case 'canceled': return { text: 'cancelou a delegação' };
    case 'child_canceled': return { text: 'cancelou a delegação para baixo', change: a.childCode };
    case 'redelegated': return { text: `redelegou para ${a.to}`, change: `Prazo sugerido: ${df(a.suggestedDue)}` };
    case 'transferred': return { text: `transferiu de ${b.owner} para ${a.owner}` };
    case 'management_transferred': return { text: 'transferência de gestão', change: `Acompanhamento passou de ${b.delegator ?? '—'} para ${a.delegator}` };
    default: return { text: e.type };
  }
}

function EventLog({ cardId }: { cardId: string }) {
  const q = useQuery({ queryKey: ['events', cardId], queryFn: () => get<Ev[]>(`/cards/${cardId}/events`) });
  if (q.isLoading) return <p className="loading">Carregando o log…</p>;
  if (q.error) return <ErrorText error={q.error} />;
  return (
    <div>
      <p className="hint" style={{ marginBottom: 8 }}>Registro completo e imutável. Visível para administração, CEO e diretoria.</p>
      <ol className="log">
        {q.data!.map((e) => {
          const d = describe(e);
          return (
            <li key={e.id}>
              <time>{dateTime(e.created_at)}</time>
              <span><b style={{ fontWeight: 500 }}>{e.actor_name ?? 'Sistema'}</b> {d.text}{d.change && <span className="chg">{d.change}</span>}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Itens 16 e 10: mover para qualquer quadro e fase da pessoa, ou para o topo/fim da fase atual. */
function MoveTo({ cardId, boardId, listId }: { cardId: string; boardId: string; listId: string }) {
  const { run, busy } = useAction();
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<{ id: string; name: string }[]>('/boards') });
  const [targetBoard, setTargetBoard] = useState(boardId);
  const lists = useQuery({ queryKey: ['board', targetBoard], queryFn: () => get<{ lists: { id: string; name: string }[] }>(`/boards/${targetBoard}`) });
  const [targetList, setTargetList] = useState(listId);
  useEffect(() => { setTargetBoard(boardId); setTargetList(listId); }, [boardId, listId]);
  const options = lists.data?.lists ?? [];
  const chosenList = options.some((l) => l.id === targetList) ? targetList : options[0]?.id ?? '';
  const changed = targetBoard !== boardId || chosenList !== listId;
  const boardName = boards.data?.find((b) => b.id === targetBoard)?.name;
  const listName = options.find((l) => l.id === chosenList)?.name;
  return (
    <div className="field">
      <span className="label">Mover para</span>
      <select className="select input" aria-label="Quadro" value={targetBoard} onChange={(e) => setTargetBoard(e.target.value)}>
        {boards.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <select className="select input" aria-label="Fase" value={chosenList} onChange={(e) => setTargetList(e.target.value)}>
        {options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      {changed ? (
        <button className="b" disabled={busy || !chosenList}
          onClick={() => run(() => post(`/cards/${cardId}/move`, { listId: chosenList }), `Tarefa movida para ${targetBoard !== boardId ? `“${boardName}” · ` : ''}“${listName}”.`)}>
          <Icon name="move" />Mover
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4 }}>
          <button className="b sm" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => post(`/cards/${cardId}/move`, { listId, place: 'top' }), 'Tarefa no topo da fase.')}>Para o topo</button>
          <button className="b sm" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => post(`/cards/${cardId}/move`, { listId, place: 'end' }), 'Tarefa no fim da fase.')}>Para o fim</button>
        </div>
      )}
    </div>
  );
}
