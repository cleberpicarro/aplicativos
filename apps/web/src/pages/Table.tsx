import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { get, type Card } from '../lib/api';
import { go } from '../lib/router';
import { cardNo, fullDate } from '../lib/format';
import { Dialog, Due, ErrorText, useMe, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { COLOR_VALUES, COLUMNS, DEFAULT_COLUMNS, SOURCE_VALUES, toCsv, type Column } from '../lib/tableFilter';
import { FilterBar, load, save, useTaskFilter } from '../components/TaskFilter';

/* Item 36: as tarefas da pessoa em tabela, com filtro por condições e filtros salvos (o filtro é o mesmo do Quadro, item 47). */

type Row = Card & { boardName: string | null; listName: string | null };

const COL_KEY = 'synctasks.tabela.colunas';
const SORT_KEY = 'synctasks.tabela.ordem';

const spDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : null);
const br = (iso: string | null) => { const d = spDay(iso); return d ? fullDate(d) : ''; };
const sourceLabel = (s: Card['source']) => SOURCE_VALUES.find((x) => x.id === (s ?? 'manual'))?.label ?? '';

function delegationText(r: Row): { text: string; kind: 'del' | 'rec' } | null {
  if (r.child) return { text: `Delegada para ${r.child.ownerName}${r.child.status === 'AWAITING_ACK' ? ' · aguarda seu ciente' : ''}`, kind: 'del' };
  if (r.delegation) return { text: `Recebida de ${r.delegation.delegatorName}`, kind: 'rec' };
  if (r.transferredFrom) return { text: `Transferida por ${r.transferredFrom.name}`, kind: 'rec' };
  return null;
}
const statusText = (r: Row) => (r.archivedAt ? 'Arquivada' : r.completedAt ? 'Concluída' : 'Aberta');
const whereText = (r: Row) => (r.inInbox || !r.boardName ? 'Caixa de entrada' : `${r.boardName} · ${r.listName}`);

export function TablePage() {
  const me = useMe().data!;
  const toast = useToast();
  const f = useTaskFilter();
  const [cols, setCols] = useState<Column[]>(() => load(COL_KEY, DEFAULT_COLUMNS, (v) => Array.isArray(v)));
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>(() => load(SORT_KEY, { by: 'due', dir: 'asc' }, (v) => v && v.by));
  const [choosingCols, setChoosingCols] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => save(COL_KEY, cols), [cols]);
  useEffect(() => save(SORT_KEY, sort), [sort]);

  const qs = `filter=${f.param}&sort=${sort.by}&dir=${sort.dir}`;
  const rows = useInfiniteQuery({
    queryKey: ['table', qs],
    queryFn: ({ pageParam }) => get<{ total: number; rows: Row[] }>(`/table?${qs}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const n = pages.reduce((s, p) => s + p.rows.length, 0);
      return n < last.total ? n : undefined;
    },
  });
  const list = rows.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = rows.data?.pages[0]?.total ?? 0;

  const toggleSort = (by: string) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' }));

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await get<{ total: number; rows: Row[] }>(`/table?${qs}&limit=5000`);
      const shown = COLUMNS.filter((c) => cols.includes(c.id));
      const csv = toCsv(shown.map((c) => c.label), all.rows.map((r) => shown.map((c) => csvCell(r, c.id))));
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `tarefas-${me.today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      if (all.total > all.rows.length) toast(`A planilha traz as primeiras ${all.rows.length} de ${all.total} tarefas. Use um filtro para reduzir.`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const shown = COLUMNS.filter((c) => cols.includes(c.id));

  return (
    <div className="page wide tbl-page">
      <FilterBar f={f}>
        <button className="b sm" onClick={() => setChoosingCols(true)}>Colunas</button>
        <button className="b sm" disabled={exporting || total === 0} onClick={exportCsv}>{exporting ? 'Gerando…' : 'Exportar planilha'}</button>
      </FilterBar>

      <ErrorText error={rows.error} />
      {rows.isLoading && <p className="loading">Carregando…</p>}
      {rows.data && list.length === 0 && (
        <div className="empty"><b>Nenhuma tarefa.</b>{f.active ? 'Nenhuma tarefa atende a este filtro.' : 'Crie tarefas nos seus quadros e elas aparecem aqui.'}</div>
      )}
      {list.length > 0 && (
        <div className="table-wrap">
          <table className="t tasks">
            <thead>
              <tr>
                {shown.map((c) => (
                  <th key={c.id} aria-sort={sort.by === c.sort ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button className={`th-sort${sort.by === c.sort ? ' on' : ''}`} onClick={() => toggleSort(c.sort!)}>
                        {c.label}{sort.by === c.sort && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => go(`/tarefa/${r.id}`)}>
                  {shown.map((c) => <td key={c.id} className={`c-${c.id}`}>{cellView(r, c.id, me.today)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="tbl-foot">
        <span>{rows.data ? `${list.length < total ? `${list.length} de ` : ''}${total} ${total === 1 ? 'tarefa' : 'tarefas'}` : ''}</span>
        {rows.hasNextPage && <button className="b" disabled={rows.isFetchingNextPage} onClick={() => rows.fetchNextPage()}>{rows.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}</button>}
        <span className="hint">Clique numa linha para abrir a tarefa; no título da coluna, para ordenar.</span>
      </div>

      {choosingCols && <ColumnsDialog cols={cols} onChange={setCols} onClose={() => setChoosingCols(false)} />}
    </div>
  );
}

function cellView(r: Row, col: Column, today: string) {
  switch (col) {
    case 'code': return <span className="code">{cardNo(r.num)}</span>;
    case 'title': return (
      <span className="ttl">
        {r.color && <span className={`dot-color card-tone bc-${r.color}`} title={`Cor: ${COLOR_VALUES.find((x) => x.id === r.color)?.label ?? r.color}`} />}
        <button className={`cell-link${r.completedAt ? ' done-t' : ''}`} title={r.title} onClick={(e) => { e.stopPropagation(); go(`/tarefa/${r.id}`); }}>{r.title}</button>
        {r.isPrivate && <span className="ico" title="Privada"><Icon name="lock" /></span>}
      </span>
    );
    case 'where': return <span className="muted">{whereText(r)}</span>;
    case 'due': return <Due date={r.dueDate} done={!!r.completedAt} today={today} />;
    case 'status': return <span className={`st ${r.archivedAt ? 'arch' : r.completedAt ? 'done' : 'open'}`}><span className="dot" />{statusText(r)}</span>;
    case 'delegation': {
      const d = delegationText(r);
      return d ? <span className={`tag ${d.kind}`}>{d.text}</span> : null;
    }
    case 'checklist': return r.checklist.total ? `${r.checklist.done}/${r.checklist.total}` : <span className="faint">—</span>;
    case 'created': return br(r.createdAt);
    case 'completed': return br(r.completedAt);
    case 'archived': return br(r.archivedAt);
    case 'private': return r.isPrivate ? 'Sim' : '';
    case 'source': return <span className="muted">{sourceLabel(r.source)}</span>;
    case 'description': return <span className="desc" title={r.description}>{r.description.split('\n')[0]}</span>;
  }
}

function csvCell(r: Row, col: Column): string | number | null {
  switch (col) {
    case 'code': return cardNo(r.num);
    case 'title': return r.title;
    case 'where': return whereText(r);
    case 'due': return r.dueDate ? fullDate(r.dueDate) : '';
    case 'status': return statusText(r);
    case 'delegation': return delegationText(r)?.text ?? '';
    case 'checklist': return r.checklist.total ? `${r.checklist.done}/${r.checklist.total}` : '';
    case 'created': return br(r.createdAt);
    case 'completed': return br(r.completedAt);
    case 'archived': return br(r.archivedAt);
    case 'private': return r.isPrivate ? 'Sim' : 'Não';
    case 'source': return sourceLabel(r.source);
    case 'description': return r.description;
  }
}

function ColumnsDialog({ cols, onChange, onClose }: { cols: Column[]; onChange: (c: Column[]) => void; onClose: () => void }) {
  const toggle = (id: Column) => onChange(cols.includes(id) ? cols.filter((c) => c !== id) : COLUMNS.map((c) => c.id).filter((c) => c === id || cols.includes(c)));
  return (
    <Dialog title="Colunas" onClose={onClose} footer={<><button className="b" onClick={() => onChange(DEFAULT_COLUMNS)}>Voltar ao padrão</button><span className="grow" /><button className="b pri" onClick={onClose}>Pronto</button></>}>
      <div className="cols">
        {COLUMNS.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={cols.includes(c.id)} disabled={c.fixed} onChange={() => toggle(c.id)} /> {c.label}
          </label>
        ))}
      </div>
    </Dialog>
  );
}
