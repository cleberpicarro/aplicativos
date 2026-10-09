import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api';
import { go } from '../lib/router';
import { fullDate } from '../lib/format';
import { ErrorText, useToast } from '../components/ui';

/** Item 35: tarefas arquivadas pela pessoa (as próprias e as delegadas com ciente), com pesquisa e desarquivar. */
export interface ArchivedItem {
  id: string;
  code: string;
  title: string;
  dueDate: string | null;
  completedAt: string | null;
  archivedAt: string;
  createdAt: string;
  kind: 'own' | 'delegated';
  boardName: string | null;
  listName: string | null;
  delegatedTo: string | null;
}

const day = (iso: string | null) => (iso ? fullDate(new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })) : '—');

export function ArchivedPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const list = useInfiniteQuery({
    queryKey: ['archived', term],
    queryFn: ({ pageParam }) => get<{ items: ArchivedItem[]; hasMore: boolean }>(`/archived?q=${encodeURIComponent(term)}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((n, p) => n + p.items.length, 0) : undefined),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const unarchive = async (it: ArchivedItem) => {
    setBusy(it.id);
    try {
      await post(`/cards/${it.id}/unarchive`);
      await qc.invalidateQueries();
      toast(`Tarefa desarquivada: de volta a ${it.boardName ? `“${it.boardName}”` : 'um quadro'}.`, 'ok', {
        label: 'Desfazer',
        onClick: () => post(`/cards/${it.id}/archive`).then(() => qc.invalidateQueries(), (e) => toast((e as Error).message, 'error')),
      });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page wide">
      <div className="arch-bar">
        <input className="input" type="search" placeholder="Pesquisar por código (ST-000123) ou texto" aria-label="Pesquisar nas arquivadas"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorText error={list.error} />
      {list.isLoading && <p className="loading">Carregando…</p>}
      {list.data && items.length === 0 && (
        term
          ? <div className="empty"><b>Nada encontrado.</b>Nenhuma tarefa arquivada tem esse código ou texto.</div>
          : <div className="empty"><b>Nenhuma tarefa arquivada.</b>Quando você arquivar uma tarefa concluída, ou der ciente numa tarefa que delegou, ela aparece aqui.</div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table className="t arch">
            <thead>
              <tr><th>Código</th><th>Tarefa</th><th>Quadro · Fase</th><th>Concluída em</th><th>Arquivada em</th><th aria-label="Ações" /></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="code">{it.code}</td>
                  <td className="c-title">
                    <span className="ttl">
                    <button className="cell-link" onClick={() => go(`/tarefa/${it.code}`)} title={it.title}>{it.title}</button>
                    {it.kind === 'delegated' && <span className="tag del" title="Você delegou e deu o ciente">Delegada para {it.delegatedTo}</span>}
                    </span>
                  </td>
                  <td className="muted">{it.boardName ? `${it.boardName} · ${it.listName}` : '—'}</td>
                  <td className="c-date">{day(it.completedAt)}</td>
                  <td className="c-date">{day(it.archivedAt)}</td>
                  <td className="c-acts">
                    {it.kind === 'own'
                      ? <button className="b sm" disabled={busy === it.id} onClick={() => unarchive(it)}>Desarquivar</button>
                      : <span className="hint" title="O ciente não se desfaz">Só consulta</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.hasNextPage && (
        <div className="more"><button className="b" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>{list.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</button></div>
      )}
    </div>
  );
}
