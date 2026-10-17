import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, patch, post } from '../lib/api';
import { Dialog, ErrorText, useMe, useToast } from './ui';
import { Icon } from './Icons';
import {
  BOARD_IGNORED, COLOR_VALUES, EMPTY, FIELDS, READY, SOURCE_VALUES, STATUS_VALUES, cleanFilter, defaultValue, describe, fieldOf, isComplete,
  needsValue, newCondition, opLabel, opsFor, type Condition, type Field, type Filter, type Names, type Op, type Quick, type Value,
} from '../lib/tableFilter';

/*
 * Itens 36 e 47: o filtro das tarefas, o mesmo na Tabela e no Quadro. A escolha fica guardada no navegador
 * e vale para as duas visões: o filtro ligado na Tabela continua ligado ao trocar para o Quadro e vice-versa.
 */

export interface Options {
  boards: { id: string; name: string; lists: { id: string; name: string }[] }[];
  delegatedTo: { id: string; name: string }[];
  receivedFrom: { id: string; name: string }[];
}
interface Saved { id: string; name: string; filter: Filter }
/** Filtro em uso: um pronto, um salvo ou um avulso (sem nome). */
export interface Current { name: string; savedId: string | null; readyId: string | null; filter: Filter }

const CUR_KEY = 'synctasks.tabela.filtro';
const QUICK_KEY = 'synctasks.filtro.atalhos';
const NONE: Current = { name: 'Sem filtro', savedId: null, readyId: null, filter: EMPTY };
const NO_QUICK: Quick = { toMe: false, byMe: false };

export function load<T>(key: string, fallback: T, ok: (v: any) => boolean): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v !== null && ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
export function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* sem armazenamento: só não lembra */ }
}

/** Estado do filtro (escolhido + atalhos de delegadas), guardado no navegador e o mesmo nas duas visões. */
export function useTaskFilter() {
  const [cur, setCur] = useState<Current>(() => load(CUR_KEY, NONE, (v) => v && v.filter && Array.isArray(v.filter.all)));
  const [quick, setQuick] = useState<Quick>(() => load(QUICK_KEY, NO_QUICK, (v) => v && typeof v.toMe === 'boolean'));
  useEffect(() => save(CUR_KEY, cur), [cur]);
  useEffect(() => save(QUICK_KEY, quick), [quick]);
  const options = useQuery({ queryKey: ['table-options'], queryFn: () => get<Options>('/table/options') });
  const saved = useQuery({ queryKey: ['filters'], queryFn: () => get<Saved[]>('/filters') });
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
  const hasConds = cur.filter.all.length + cur.filter.any.length > 0;
  const hasQuick = quick.toMe || quick.byMe;
  /** O que vai para o servidor: as condições completas e os atalhos ligados. */
  const sent: Filter = { ...cleanFilter(cur.filter), ...(hasQuick ? { quick } : {}) };
  const clear = () => { setCur(NONE); setQuick(NO_QUICK); };
  return { cur, setCur, quick, setQuick, options, saved, names, hasConds, hasQuick, active: hasConds || hasQuick, sent, param: encodeURIComponent(JSON.stringify(sent)), clear };
}
export type TaskFilter = ReturnType<typeof useTaskFilter>;

/** Barra do filtro: botão Filtro, atalhos de delegadas, etiquetas com × e Editar filtro. `children` vai à direita. */
export function FilterBar({ f, onBoard = false, children }: { f: TaskFilter; onBoard?: boolean; children?: ReactNode }) {
  const me = useMe().data!;
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Current | null>(null);
  const [picking, setPicking] = useState(false);
  const { cur, setCur, quick, setQuick, names } = f;
  const removeCond = (group: 'all' | 'any', i: number) =>
    setCur((c) => ({ ...c, savedId: null, readyId: null, name: 'Filtro alterado', filter: { ...c.filter, [group]: c.filter[group].filter((_, j) => j !== i) } }));
  const ignored = (c: Condition) => onBoard && BOARD_IGNORED.includes(c.field);
  const chipTitle = (c: Condition) => (ignored(c) ? 'Esta condição não vale dentro de um quadro e é ignorada aqui.' : undefined);
  // Item 47: "para mim" só faz sentido para quem tem superior; "por mim", para quem tem subordinados.
  const showToMe = !!me.user.managerId || quick.toMe;
  const showByMe = me.directReports.length > 0 || quick.byMe;
  return (
    <div className="tbl-bar">
      <div className="menu">
        <button className={`b fsel${f.hasConds ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
          <Icon name="filter" /> Filtro: {cur.name} <Icon name="car" />
        </button>
        {picking && (
          <FilterPicker saved={f.saved.data ?? []} current={cur} onClose={() => setPicking(false)}
            onPick={(c) => { setCur(c); setPicking(false); }}
            onNew={() => { setPicking(false); setEditing({ name: '', savedId: null, readyId: null, filter: { all: [newCondition()], any: [] } }); }} />
        )}
      </div>
      {(showToMe || showByMe) && (
        <span className="quick" role="group" aria-label="Atalhos de tarefas delegadas">
          {showToMe && (
            <button className={`b sm qk to-me${quick.toMe ? ' on' : ''}`} aria-pressed={quick.toMe} title="Só as tarefas que chegaram para você por delegação. Clique de novo para desligar."
              onClick={() => setQuick((q) => ({ ...q, toMe: !q.toMe }))}><Icon name="into" />Delegadas para mim</button>
          )}
          {showByMe && (
            <button className={`b sm qk by-me${quick.byMe ? ' on' : ''}`} aria-pressed={quick.byMe} title="Só as tarefas que você delegou e ainda estão em aberto. Clique de novo para desligar."
              onClick={() => setQuick((q) => ({ ...q, byMe: !q.byMe }))}><Icon name="out" />Delegadas por mim</button>
          )}
        </span>
      )}
      {quick.toMe && <span className="chip">Delegadas para mim<button aria-label="Desligar Delegadas para mim" onClick={() => setQuick((q) => ({ ...q, toMe: false }))}><Icon name="x" /></button></span>}
      {quick.byMe && <span className="chip">Delegadas por mim<button aria-label="Desligar Delegadas por mim" onClick={() => setQuick((q) => ({ ...q, byMe: false }))}><Icon name="x" /></button></span>}
      {cur.filter.all.map((c, i) => (
        <span key={`a${i}`} className={`chip${ignored(c) ? ' off' : ''}`} title={chipTitle(c)}>{describe(c, names)}<button aria-label="Tirar esta condição" onClick={() => removeCond('all', i)}><Icon name="x" /></button></span>
      ))}
      {cur.filter.any.length > 0 && (
        <span className="chip any">
          {cur.filter.any.map((c, i) => (
            <Fragment key={`o${i}`}>
              {i > 0 && <span className="or">ou</span>}
              <span className={ignored(c) ? 'off' : undefined} title={chipTitle(c)}>{describe(c, names)}</span><button aria-label="Tirar esta condição" onClick={() => removeCond('any', i)}><Icon name="x" /></button>
            </Fragment>
          ))}
        </span>
      )}
      <span className="grow" />
      <button className="b sm" onClick={() => setEditing(f.hasConds ? cur : { ...cur, filter: { all: [newCondition()], any: [] } })}>
        <Icon name="plus" /> {f.hasConds ? 'Editar filtro' : 'Condição'}
      </button>
      {children}
      {editing && (
        <FilterEditor
          initial={editing}
          options={f.options.data}
          onBoard={onBoard}
          onClose={() => setEditing(null)}
          onApply={(c) => { setCur(c); setEditing(null); }}
          onSaved={async (c) => { await qc.invalidateQueries({ queryKey: ['filters'] }); setCur(c); setEditing(null); toast(`Filtro “${c.name}” salvo.`); }}
          onDeleted={async () => { await qc.invalidateQueries({ queryKey: ['filters'] }); setCur(NONE); setEditing(null); toast('Filtro excluído.'); }}
        />
      )}
    </div>
  );
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

function FilterEditor({ initial, options, onBoard, onClose, onApply, onSaved, onDeleted }: {
  initial: Current; options?: Options; onBoard: boolean; onClose: () => void; onApply: (c: Current) => void;
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
      {f[g].map((c, i) => <CondRow key={i} c={c} options={options} onBoard={onBoard} onChange={(n) => setCond(g, i, n)} onRemove={() => rmCond(g, i)} />)}
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
        <p className="hint">Mostra as tarefas que atendem a <b>todas</b> as condições do primeiro bloco e a <b>pelo menos uma</b> do segundo. Um bloco vazio não conta. O filtro vale para a Tabela e para o Quadro.</p>
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

function CondRow({ c, options, onBoard, onChange, onRemove }: { c: Condition; options?: Options; onBoard: boolean; onChange: (c: Condition) => void; onRemove: () => void }) {
  const setField = (field: Field) => { const op = opsFor(field)[0]; onChange({ field, op, value: defaultValue(field, op) }); };
  const setOp = (op: Op) => {
    const keep = needsValue(op) && needsValue(c.op) && (op === 'between') === (c.op === 'between')
      && (op === 'last_days' || op === 'next_days') === (c.op === 'last_days' || c.op === 'next_days');
    onChange({ ...c, op, value: keep ? c.value ?? null : defaultValue(c.field, op) });
  };
  return (
    <div className="frow">
      <select className="select" aria-label="Campo" value={c.field} onChange={(e) => setField(e.target.value as Field)}>
        {/* Item 47: no quadro, "Quadro" e "Arquivada" não fazem sentido (a não ser numa condição que já veio da tabela). */}
        {FIELDS.filter((f) => !onBoard || !BOARD_IGNORED.includes(f.id) || f.id === c.field).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
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

