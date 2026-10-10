import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post, type Card } from '../lib/api';
import { go } from '../lib/router';
import { cardNo, fullDate } from '../lib/format';
import { Dialog, Due, ErrorText, useMe, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import {
  COLOR_VALUES, COLUMNS, DEFAULT_COLUMNS, EMPTY, FIELDS, READY, SOURCE_VALUES, STATUS_VALUES, cleanFilter, defaultValue, describe, fieldOf, isComplete,
  needsValue, newCondition, opLabel, opsFor, toCsv, type Column, type Condition, type Field, type Filter, type Names, type Op, type Value,
} from '../lib/tableFilter';

/* Item 36: as tarefas da pessoa em tabela, com filtro por condições e filtros salvos. */

type Row = Card & { boardName: string | null; listName: string | null };
interface Options {
  boards: { id: string; name: string; lists: { id: string; name: string }[] }[];
  delegatedTo: { id: string; name: string }[];
  receivedFrom: { id: string; name: string }[];
}
interface Saved { id: string; name: string; filter: Filter }
/** Filtro em uso: um pronto, um salvo ou um avulso (sem nome). */
interface Current { name: string; savedId: string | null; readyId: string | null; filter: Filter }

const CUR_KEY = 'synctasks.tabela.filtro';
const COL_KEY = 'synctasks.tabela.colunas';
const SORT_KEY = 'synctasks.tabela.ordem';
const NONE: Current = { name: 'Sem filtro', savedId: null, readyId: null, filter: EMPTY };

function load<T>(key: string, fallback: T, ok: (v: any) => boolean): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v !== null && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ }
}

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
  const qc = useQueryClient();
  const toast = useToast();
  const [cur, setCur] = useState<Current>(() => load(CUR_KEY, NONE, (v) => v && v.filter && Array.isArray(v.filter.all)));
  const [cols, setCols] = useState<Column[]>(() => load(COL_KEY, DEFAULT_COLUMNS, (v) => Array.isArray(v)));
  const [sort, setSort] = useState<{ by: string; dir: 'asc' | 'desc' }>(() => load(SORT_KEY, { by: 'due', dir: 'asc' }, (v) => v && v.by));
  const [editing, setEditing] = useState<Current | null>(null);
  const [picking, setPicking] = useState(false);
  const [choosingCols, setChoosingCols] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => save(CUR_KEY, cur), [cur]);
  useEffect(() => save(COL_KEY, cols), [cols]);
  useEffect(() => save(SORT_KEY, sort), [sort]);

  const options = useQuery({ queryKey: ['table-options'], queryFn: () => get<Options>('/table/options') });
  const saved = useQuery({ queryKey: ['filters'], queryFn: () => get<Saved[]>('/filters') });
  const filter = cleanFilter(cur.filter);
  const qs = `filter=${encodeURIComponent(JSON.stringify(filter))}&sort=${sort.by}&dir=${sort.dir}`;
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

  const names: Names = useMemo(() => {
    const o = options.data;
    const people: Record<string, string> = {};
    for (const p of [...(o?.delegatedTo ?? []), ...(o?.receivedFrom ?? [])]) people[p.id] = p.name;
    const boards: Record<string, string> = {};
    const lists: Record<string, string> = {};
    for (const b of o?.boards ?? []) {
      boards[b.id] = b.name;
      for (const l of b.lists) lists[l.id] = `${b.name} · ${l.name}`;
    }
    return { boards, lists, people };
  }, [options.data]);

  const removeCond = (group: 'all' | 'any', i: number) =>
    setCur((c) => ({ ...c, savedId: null, readyId: null, name: 'Filtro alterado', filter: { ...c.filter, [group]: c.filter[group].filter((_, j) => j !== i) } }));
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
  const hasConds = cur.filter.all.length + cur.filter.any.length > 0;

  return (
    <div className="page wide tbl-page">
      <div className="tbl-bar">
        <div className="menu">
          <button className={`b fsel${hasConds ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
            <Icon name="filter" /> Filtro: {cur.name} <Icon name="car" />
          </button>
          {picking && (
            <FilterPicker saved={saved.data ?? []} current={cur} onClose={() => setPicking(false)}
              onPick={(c) => { setCur(c); setPicking(false); }}
              onNew={() => { setPicking(false); setEditing({ name: '', savedId: null, readyId: null, filter: { all: [newCondition()], any: [] } }); }} />
          )}
        </div>
        {cur.filter.all.map((c, i) => (
          <span key={`a${i}`} className="chip">{describe(c, names)}<button aria-label="Tirar esta condição" onClick={() => removeCond('all', i)}><Icon name="x" /></button></span>
        ))}
        {cur.filter.any.length > 0 && (
          <span className="chip any">
            {cur.filter.any.map((c, i) => (
              <Fragment key={`o${i}`}>
                {i > 0 && <span className="or">ou</span>}
                {describe(c, names)}<button aria-label="Tirar esta condição" onClick={() => removeCond('any', i)}><Icon name="x" /></button>
              </Fragment>
            ))}
          </span>
        )}
        <span className="grow" />
        <button className="b sm" onClick={() => setEditing(hasConds ? cur : { ...cur, filter: { all: [newCondition()], any: [] } })}>
          <Icon name="plus" /> {hasConds ? 'Editar filtro' : 'Condição'}
        </button>
        <button className="b sm" onClick={() => setChoosingCols(true)}>Colunas</button>
        <button className="b sm" disabled={exporting || total === 0} onClick={exportCsv}>{exporting ? 'Gerando…' : 'Exportar planilha'}</button>
      </div>

      <ErrorText error={rows.error} />
      {rows.isLoading && <p className="loading">Carregando…</p>}
      {rows.data && list.length === 0 && (
        <div className="empty"><b>Nenhuma tarefa.</b>{hasConds ? 'Nenhuma tarefa atende a este filtro.' : 'Crie tarefas nos seus quadros e elas aparecem aqui.'}</div>
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

      {editing && (
        <FilterEditor
          initial={editing}
          options={options.data}
          onClose={() => setEditing(null)}
          onApply={(c) => { setCur(c); setEditing(null); }}
          onSaved={async (c) => { await qc.invalidateQueries({ queryKey: ['filters'] }); setCur(c); setEditing(null); toast(`Filtro “${c.name}” salvo.`); }}
          onDeleted={async () => { await qc.invalidateQueries({ queryKey: ['filters'] }); setCur(NONE); setEditing(null); toast('Filtro excluído.'); }}
        />
      )}
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

function FilterPicker({ saved, current, onPick, onNew, onClose }: { saved: Saved[]; current: Current; onPick: (c: Current) => void; onNew: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  const item = (key: string, label: string, on: boolean, c: Current) => (
    <button key={key} role="menuitemradio" aria-checked={on} className={on ? 'on' : ''} onClick={() => onPick(c)}>{label}</button>
  );
  return (
    <div className="menu-pop fpick" role="menu" ref={ref}>
      {item('none', 'Sem filtro', !current.savedId && !current.readyId && current.filter.all.length + current.filter.any.length === 0, NONE)}
      <div className="menu-h">Prontos</div>
      {READY.map((r) => item(r.id, r.name, current.readyId === r.id, { name: r.name, savedId: null, readyId: r.id, filter: r.filter }))}
      <div className="menu-h">Meus filtros</div>
      {saved.length === 0 && <p className="hint pad">Nenhum ainda. Em “Novo filtro”, dê um nome e clique em “Salvar filtro”.</p>}
      {saved.map((s) => item(s.id, s.name, current.savedId === s.id, { name: s.name, savedId: s.id, readyId: null, filter: s.filter }))}
      <hr className="menu-sep" />
      <button role="menuitem" className="new" onClick={onNew}><Icon name="plus" /> Novo filtro</button>
    </div>
  );
}

function FilterEditor({ initial, options, onClose, onApply, onSaved, onDeleted }: {
  initial: Current; options?: Options; onClose: () => void; onApply: (c: Current) => void;
  onSaved: (c: Current) => void; onDeleted: () => void;
}) {
  const [f, setF] = useState<Filter>(initial.filter);
  const [name, setName] = useState(initial.savedId ? initial.name : initial.readyId ? `${initial.name} (cópia)` : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const incomplete = [...f.all, ...f.any].some((c) => !isComplete(c));

  const setCond = (g: 'all' | 'any', i: number, c: Condition) => setF((x) => ({ ...x, [g]: x[g].map((y, j) => (j === i ? c : y)) }));
  const addCond = (g: 'all' | 'any') => setF((x) => ({ ...x, [g]: [...x[g], newCondition(g === 'any' ? 'due' : 'title')] }));
  const rmCond = (g: 'all' | 'any', i: number) => setF((x) => ({ ...x, [g]: x[g].filter((_, j) => j !== i) }));

  const apply = () => onApply({ name: initial.savedId && name.trim() ? name.trim() : 'Filtro avulso', savedId: null, readyId: null, filter: cleanFilter(f) });
  const saveIt = async () => {
    if (!name.trim()) { setErr(new Error('Dê um nome ao filtro para salvar.')); return; }
    setBusy(true);
    setErr(null);
    try {
      const clean = cleanFilter(f);
      const s = initial.savedId
        ? await patch<Saved>(`/filters/${initial.savedId}`, { name, filter: clean })
        : await post<Saved>('/filters', { name, filter: clean });
      onSaved({ name: s.name, savedId: s.id, readyId: null, filter: s.filter });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!initial.savedId || !window.confirm(`Excluir o filtro “${initial.name}”?`)) return;
    setBusy(true);
    try {
      await del(`/filters/${initial.savedId}`);
      onDeleted();
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  };

  const block = (g: 'all' | 'any', title: string, note: string) => (
    <div className="fgroup">
      <h4>{title} <small>({note})</small></h4>
      {f[g].map((c, i) => <CondRow key={i} c={c} options={options} onChange={(n) => setCond(g, i, n)} onRemove={() => rmCond(g, i)} />)}
      <button className="link" onClick={() => addCond(g)}><Icon name="plus" /> Adicionar condição</button>
    </div>
  );

  return (
    <Dialog title={initial.savedId ? 'Editar filtro' : 'Filtro'} onClose={onClose} wide
      footer={
        <>
          {initial.savedId && <button className="b danger" disabled={busy} onClick={remove}>Excluir filtro</button>}
          <span className="grow" />
          <button className="b" onClick={onClose}>Cancelar</button>
          <button className="b" disabled={busy || incomplete} onClick={apply}>Só aplicar</button>
          <button className="b pri" disabled={busy || incomplete} onClick={saveIt}>{initial.savedId ? 'Salvar e aplicar' : 'Salvar filtro'}</button>
        </>
      }>
      <div className="feditor">
        <p className="hint">Mostra as tarefas que atendem a <b>todas</b> as condições do primeiro bloco e a <b>pelo menos uma</b> do segundo. Um bloco vazio não conta.</p>
        {block('all', 'Todas estas condições', 'E')}
        {block('any', 'Qualquer uma destas condições', 'OU')}
        <div className="field">
          <label htmlFor="fname">Nome do filtro {initial.savedId ? '' : '(para salvar)'}</label>
          <input id="fname" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Atrasadas ou vencem na semana" />
        </div>
        {incomplete && <p className="hint">Preencha o valor de cada condição (ou tire a condição) para aplicar.</p>}
        <ErrorText error={err} />
      </div>
    </Dialog>
  );
}

function CondRow({ c, options, onChange, onRemove }: { c: Condition; options?: Options; onChange: (c: Condition) => void; onRemove: () => void }) {
  const setField = (field: Field) => { const op = opsFor(field)[0]; onChange({ field, op, value: defaultValue(field, op) }); };
  const setOp = (op: Op) => {
    const keep = needsValue(op) && needsValue(c.op) && (op === 'between') === (c.op === 'between')
      && (op === 'last_days' || op === 'next_days') === (c.op === 'last_days' || c.op === 'next_days');
    onChange({ ...c, op, value: keep ? c.value ?? null : defaultValue(c.field, op) });
  };
  return (
    <div className="frow">
      <select className="select" aria-label="Campo" value={c.field} onChange={(e) => setField(e.target.value as Field)}>
        {FIELDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
      </select>
      <select className="select" aria-label="Operador" value={c.op} onChange={(e) => setOp(e.target.value as Op)}>
        {opsFor(c.field).map((o) => <option key={o} value={o}>{opLabel(c.field, o)}</option>)}
      </select>
      <div className="fval">{needsValue(c.op) && <ValueInput c={c} options={options} onChange={(value) => onChange({ ...c, value })} />}</div>
      <button className="b ghost icon sm" aria-label="Tirar condição" onClick={onRemove}><Icon name="x" /></button>
    </div>
  );
}

function ValueInput({ c, options, onChange }: { c: Condition; options?: Options; onChange: (v: Value) => void }) {
  const kind = fieldOf(c.field).kind;
  const v = c.value;
  if (c.op === 'last_days' || c.op === 'next_days') {
    return (
      <span className="days">
        <input className="input" type="number" min={0} max={3650} aria-label="Dias" value={typeof v === 'number' ? v : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Math.max(0, Math.min(3650, Math.trunc(Number(e.target.value)))))} />
        <span>dias</span>
      </span>
    );
  }
  if (c.op === 'between') {
    const pair: [string, string] = Array.isArray(v) ? v : ['', ''];
    return (
      <span className="days">
        <input className="input" type="date" aria-label="De" value={pair[0]} onChange={(e) => onChange([e.target.value, pair[1]])} />
        <span>e</span>
        <input className="input" type="date" aria-label="Até" value={pair[1]} onChange={(e) => onChange([pair[0], e.target.value])} />
      </span>
    );
  }
  const select = (items: { id: string; label: string }[], placeholder = 'Escolha…') => (
    <select className="select" aria-label="Valor" value={String(v ?? '')} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>{placeholder}</option>
      {items.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
    </select>
  );
  switch (kind) {
    case 'date':
      return (
        <span className="days">
          <select className="select" aria-label="Data" value={v === 'today' ? 'today' : 'date'} onChange={(e) => onChange(e.target.value === 'today' ? 'today' : '')}>
            <option value="today">Hoje</option>
            <option value="date">Escolher data</option>
          </select>
          {v !== 'today' && <input className="input" type="date" aria-label="Data escolhida" value={typeof v === 'string' ? v : ''} onChange={(e) => onChange(e.target.value)} />}
        </span>
      );
    case 'status': return select(STATUS_VALUES.map((s) => ({ id: s.id, label: s.label })));
    case 'source': return select(SOURCE_VALUES.map((s) => ({ id: s.id, label: s.label })));
    case 'color': return select(COLOR_VALUES);
    case 'bool':
      return (
        <select className="select" aria-label="Valor" value={v ? 'sim' : 'nao'} onChange={(e) => onChange(e.target.value === 'sim')}>
          <option value="sim">Sim</option><option value="nao">Não</option>
        </select>
      );
    case 'board': return select((options?.boards ?? []).map((b) => ({ id: b.id, label: b.name })), 'Escolha o quadro…');
    case 'list': return select((options?.boards ?? []).flatMap((b) => b.lists.map((l) => ({ id: l.id, label: `${b.name} · ${l.name}` }))), 'Escolha a fase…');
    case 'person': {
      const people = c.field === 'delegatedTo' ? options?.delegatedTo : options?.receivedFrom;
      return select((people ?? []).map((p) => ({ id: p.id, label: p.name })), 'Escolha a pessoa…');
    }
    default:
      return <input className="input" aria-label="Valor" maxLength={200} value={typeof v === 'string' ? v : ''} placeholder={kind === 'code' ? '12' : 'Texto'}
        onChange={(e) => onChange(e.target.value)} />;
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
