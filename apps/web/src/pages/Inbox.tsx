import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type Card } from '../lib/api';
import { go } from '../lib/router';
import { Avatar, CardStatusIcon, Due, useMe } from '../components/ui';
import { Icon } from '../components/Icons';
import { TIPS, cardNo, plural } from '../lib/format';
import { BookmarkletButton } from './Capture';
import { AcceptDialog, ConfirmDialog, DeclineDialog, DelegateDialog, useDiscard } from '../components/dialogs';

/** De onde a tarefa veio, como aparece na linha (e no "Selecionar de…"). */
function origin(c: Card) {
  const web = (c.source === 'web' || c.source === 'email') && !c.delegation && !c.transferredFrom;
  const from = web ? (c.source === 'email' ? 'Capturada do e-mail' : 'Capturada da web') : c.transferredFrom?.name ?? c.delegation?.delegatorName ?? '';
  const how = web ? '' : c.transferredFrom ? 'Transferida por' : 'Delegada por';
  return { web, from, how };
}

/** Item 50: só a tarefa própria se descarta; a recebida por delegação se devolve, com justificativa. */
const discardable = (c: Card) => !c.delegation;

export function InboxPage() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => get<Card[]>('/inbox'), refetchInterval: 30_000 });
  const [accepting, setAccepting] = useState<Card | null>(null);
  const [delegating, setDelegating] = useState<Card | null>(null);
  const [declining, setDeclining] = useState<Card | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const discard = useDiscard();
  const reports = me.directReports.length > 0;

  const cards = q.data ?? [];
  const canDiscard = cards.filter(discardable);
  // A seleção vale só para o que ainda está na caixa (a lista se atualiza sozinha).
  const selected = canDiscard.filter((c) => picked.has(c.id)).map((c) => c.id);
  const groups = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of canDiscard) {
      const key = origin(c).from || 'Sem origem';
      m.set(key, [...(m.get(key) ?? []), c.id]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [canDiscard]);

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allPicked = canDiscard.length > 0 && selected.length === canDiscard.length;
  const discardSelected = async () => {
    const ok = await discard(selected);
    if (ok) setPicked(new Set());
    return ok ? true : undefined;
  };

  return (
    <div className="page">
      {q.isLoading && <p className="loading">Carregando…</p>}
      {q.data && q.data.length === 0 && (
        <div className="empty"><b>Nada novo por aqui.</b>Tarefas delegadas ou transferidas para você aparecem nesta caixa até você colocá-las num quadro.</div>
      )}
      {canDiscard.length > 1 && (
        <div className="inbox-bar">
          <label className="check" title="Marca todas as tarefas que podem ser descartadas">
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(canDiscard.map((c) => c.id)))} aria-label="Selecionar todas" />
            <span>Selecionar todas</span>
          </label>
          {groups.length > 1 && (
            <select className="select input sm" aria-label="Selecionar de" value=""
              onChange={(e) => { const g = groups.find(([k]) => k === e.target.value); if (g) setPicked(new Set(g[1])); }}>
              <option value="">Selecionar de…</option>
              {groups.map(([k, ids]) => <option key={k} value={k}>{k} ({ids.length})</option>)}
            </select>
          )}
          {selected.length > 0 && (
            <>
              <span className="muted">{selected.length} {plural(selected.length, 'selecionada', 'selecionadas')}</span>
              <button className="b sm danger" title={TIPS.discard} onClick={() => setConfirmBulk(true)}><Icon name="archive" />Descartar selecionadas</button>
              <button className="b sm" onClick={() => setPicked(new Set())}>Limpar seleção</button>
            </>
          )}
        </div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="rows">
          {q.data.map((c) => {
            const { web, from, how } = origin(c);
            const note = c.description ? c.description.split('\n')[0] : '';
            return (
              <div key={c.id} className={`row inbox${picked.has(c.id) ? ' picked' : ''}`}>
                {discardable(c)
                  ? <input type="checkbox" className="pick" checked={picked.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Selecionar ${c.title}`} />
                  : <CardStatusIcon card={c} />}
                <div className="title">
                  <button onClick={() => go(`/tarefa/${c.id}`)} title={c.title}>{c.title}</button>
                  {note && <span className="note" title={note}>{note}</span>}
                </div>
                <span className="person" title={`${how} ${from}`.trim()}>{web ? <span className="ico"><Icon name="inbox" /></span> : <Avatar name={from} />}<span>{from}</span></span>
                <span className="code">{cardNo(c.num)}</span>
                <Due date={c.dueDate} today={me.today} />
                <div className="acts">
                  <button className="b pri" title={TIPS.accept} onClick={() => setAccepting(c)}>Aceitar</button>
                  {reports && !c.delegation?.noPass && <button className="b" title={TIPS.delegateInbox} onClick={() => setDelegating(c)}>Delegar</button>}
                  {discardable(c) && <button className="b" title={TIPS.discard} onClick={() => discard([c.id])}>Descartar</button>}
                  {c.delegation && !c.transferredFrom && <button className="b" title={TIPS.decline} onClick={() => setDeclining(c)}>Devolver</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="capture-tip">
        <span>Para guardar uma página da web como tarefa, arraste</span> <BookmarkletButton /> <span>para a barra de favoritos do navegador (clique nele para ver como). Ao clicar nele em qualquer site, a página vem para esta caixa de entrada. Ou</span>{' '}
        <button className="link" onClick={() => go('/capturar')}>cole um link</button>.
      </div>
      {accepting && <AcceptDialog card={accepting} onClose={() => setAccepting(null)} />}
      {delegating && <DelegateDialog card={delegating} fromInbox onClose={() => setDelegating(null)} />}
      {declining && <DeclineDialog card={declining} onClose={() => setDeclining(null)} />}
      {confirmBulk && (
        <ConfirmDialog
          title={`Descartar ${selected.length} ${plural(selected.length, 'tarefa', 'tarefas')}?`}
          text="Elas saem da caixa de entrada sem ser concluídas e vão para Arquivadas, de onde dá para desarquivar. Ninguém é avisado."
          confirm="Descartar"
          danger
          onConfirm={discardSelected}
          onClose={() => setConfirmBulk(false)}
        />
      )}
    </div>
  );
}
