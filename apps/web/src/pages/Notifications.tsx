import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { go } from '../lib/router';
import { dateTime, relative } from '../lib/format';
import { useMe } from '../components/ui';
import { Icon } from '../components/Icons';

interface Note { id: string; type: string; text: string; read_at: string | null; created_at: string; card_code: string | null; card_title: string | null }

export function NotificationsPage() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => get<Note[]>('/notifications') });
  useEffect(() => {
    if (q.data && me.counts.unread > 0) post('/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['me'] }));
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="page">
      <p className="hint" style={{ margin: '0 0 8px' }}>Cada aviso também é enviado por e-mail para {me.user.email}.</p>
      {q.isLoading && <p className="loading">Carregando…</p>}
      {q.data && q.data.length === 0 && <div className="empty"><b>Sem avisos.</b>Delegações, devoluções, conclusões e mudanças de prazo aparecem aqui.</div>}
      {q.data && q.data.length > 0 && (
        <div className="rows notes">
          {q.data.map((n) => (
            <div key={n.id} className={`row${n.read_at ? '' : ' unread'}`}>
              <span className="ico">{n.read_at ? <Icon name="bell" /> : <span className="dot" aria-label="Não lido" />}</span>
              <div className="title">
                {n.card_code ? (
                  <button onClick={() => go(`/tarefa/${n.card_code}`)} title={n.card_title ?? ''}>{n.text}</button>
                ) : (
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.text}</span>
                )}
                {n.card_code && <span className="note">{n.card_code} · {n.card_title}</span>}
              </div>
              <time className="code" title={dateTime(n.created_at)}>{relative(n.created_at)}</time>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
