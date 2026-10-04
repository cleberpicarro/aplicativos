import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, type Card } from '../lib/api';
import { go } from '../lib/router';
import { Avatar, CardStatusIcon, Due, useMe } from '../components/ui';
import { Icon } from '../components/Icons';
import { TIPS } from '../lib/format';
import { BookmarkletButton } from './Capture';
import { AcceptDialog, DeclineDialog } from '../components/dialogs';

export function InboxPage() {
  const me = useMe().data!;
  const q = useQuery({ queryKey: ['inbox'], queryFn: () => get<Card[]>('/inbox') });
  const [accepting, setAccepting] = useState<Card | null>(null);
  const [declining, setDeclining] = useState<Card | null>(null);
  return (
    <div className="page">
      {q.isLoading && <p className="loading">Carregando…</p>}
      {q.data && q.data.length === 0 && (
        <div className="empty"><b>Nada novo por aqui.</b>Tarefas delegadas ou transferidas para você aparecem nesta caixa até você colocá-las num quadro.</div>
      )}
      {q.data && q.data.length > 0 && (
        <div className="rows">
          {q.data.map((c) => {
            const web = c.source === 'web' && !c.delegation && !c.transferredFrom;
            const from = web ? 'Capturada da web' : c.transferredFrom?.name ?? c.delegation?.delegatorName ?? '';
            const how = web ? '' : c.transferredFrom ? 'Transferida por' : 'Delegada por';
            const note = c.description ? c.description.split('\n')[0] : '';
            return (
              <div key={c.id} className="row inbox">
                <CardStatusIcon card={c} />
                <div className="title">
                  <button onClick={() => go(`/tarefa/${c.code}`)} title={c.title}>{c.title}</button>
                  {note && <span className="note" title={note}>{note}</span>}
                </div>
                <span className="person" title={`${how} ${from}`.trim()}>{web ? <span className="ico"><Icon name="inbox" /></span> : <Avatar name={from} />}<span>{from}</span></span>
                <span className="code">{c.code}</span>
                <Due date={c.dueDate} today={me.today} />
                <div className="acts">
                  <button className="b pri" title={TIPS.accept} onClick={() => setAccepting(c)}>Aceitar e organizar</button>
                  {c.delegation && !c.transferredFrom && <button className="b" title={TIPS.decline} onClick={() => setDeclining(c)}>Devolver</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="capture-tip">
        <span>Para guardar uma página da web como tarefa, arraste</span> <BookmarkletButton /> <span>para a barra de favoritos do navegador. Ao clicar nele em qualquer site, a página vem para esta caixa de entrada.</span>
      </div>
      {accepting && <AcceptDialog card={accepting} onClose={() => setAccepting(null)} />}
      {declining && <DeclineDialog card={declining} onClose={() => setDeclining(null)} />}
    </div>
  );
}
