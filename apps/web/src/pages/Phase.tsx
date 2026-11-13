import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, type Board, type Card } from '../lib/api';
import { go } from '../lib/router';
import { ErrorText, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { ConfirmDialog, useAction } from '../components/dialogs';
import { load, save } from '../components/TaskFilter';
import { changeCard } from '../lib/optimistic';
import { dueTone } from '../lib/format';
import { cellView, ColumnsDialog, type Row } from './Table';
import { BOARD_COLORS } from './Boards';

/*
 * Item 85: a fase expandida. A fase abre em tela cheia como lista (só no computador). A ordem da fase é a
 * prioridade da pessoa (1º, 2º…): arrastar as linhas, Alt+↑/↓ ou digitar a posição mudam o quadro na hora.
 * Ordenar por outra coluna é só para olhar, até a pessoa clicar em “Aplicar esta ordem no quadro”.
 * Ações em massa com as caixinhas; delegar e transferir continuam uma tarefa por vez (regra do app).
 */

export type PCol = 'priority' | 'code' | 'title' | 'due' | 'status' | 'delegation' | 'checklist' | 'created' | 'completed' | 'private' | 'source' | 'description';
export const PHASE_COLUMNS: { id: PCol; label: string; sort?: boolean; fixed?: boolean }[] = [
  { id: 'priority', label: 'Prioridade', sort: true, fixed: true },
  { id: 'code', label: 'Código', sort: true, fixed: true },
  { id: 'title', label: 'Tarefa', sort: true, fixed: true },
  { id: 'due', label: 'Prazo', sort: true },
  { id: 'status', label: 'Situação', sort: true },
  { id: 'delegation', label: 'Delegação', sort: true },
  { id: 'checklist', label: 'Checklist', sort: true },
  { id: 'created', label: 'Criada em', sort: true },
  { id: 'completed', label: 'Concluída em', sort: true },
  { id: 'private', label: 'Privada' },
  { id: 'source', label: 'Origem' },
  { id: 'description', label: 'Descrição' },
];
export const PHASE_DEFAULT: PCol[] = ['priority', 'code', 'title', 'due', 'delegation', 'checklist'];
const COL_KEY = 'synctasks.fase.colunas';

type Chip = 'all' | 'late' | 'today' | 'week' | 'nodue' | 'delegated' | 'color' | 'done';
type Sort = { by: PCol; dir: 'asc' | 'desc' };
interface BulkResult { done: string[]; skipped: { id: string; title: string; reason: string }[] }

const plusDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export function chipTest(chip: Chip, c: Card, today: string): boolean {
  const open = !c.completedAt;
  switch (chip) {
    case 'all': return true;
    case 'late': return open && !!c.dueDate && c.dueDate < today;
    case 'today': return open && c.dueDate === today;
    case 'week': return open && !!c.dueDate && c.dueDate > today && c.dueDate <= plusDays(today, 7);
    case 'nodue': return open && !c.dueDate;
    case 'delegated': return !!c.delegation || !!(c.child && c.child.status !== 'CANCELED') || !!c.transferredFrom;
    case 'color': return !!c.color;
    case 'done': return !open;
  }
}
const CHIPS: { id: Chip; label: string; late?: boolean }[] = [
  { id: 'all', label: 'Todas' }, { id: 'late', label: 'Atrasadas', late: true }, { id: 'today', label: 'Hoje' },
  { id: 'week', label: 'Próximos 7 dias' }, { id: 'nodue', label: 'Sem prazo' }, { id: 'delegated', label: 'Delegadas' },
  { id: 'color', label: 'Com cor' }, { id: 'done', label: 'Concluídas' },
];

function compare(by: PCol, a: Card, b: Card): number {
  const t = (s: string | null) => (s ? Date.parse(s) : Number.POSITIVE_INFINITY);
  switch (by) {
    case 'code': return a.num - b.num;
    case 'title': return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
    case 'due': return (a.dueDate ?? '9999') < (b.dueDate ?? '9999') ? -1 : (a.dueDate ?? '9999') > (b.dueDate ?? '9999') ? 1 : 0;
    case 'status': return Number(!!a.completedAt) - Number(!!b.completedAt);
    case 'delegation': {
      const k = (c: Card) => (c.child && c.child.status !== 'CANCELED' ? 0 : c.delegation ? 1 : c.transferredFrom ? 2 : 3);
      return k(a) - k(b);
    }
    case 'checklist': {
      const k = (c: Card) => (c.checklist.total ? c.checklist.done / c.checklist.total : -1);
      return k(a) - k(b);
    }
    case 'created': return t(a.createdAt) - t(b.createdAt);
    case 'completed': return t(a.completedAt) - t(b.completedAt);
    default: return 0;
  }
}

export function PhaseView({ board, listId, today, match, onBack }: {
  board: Board; listId: string; today: string; match: Set<string> | null; onBack: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const { run, error } = useAction();
  const list = board.lists.find((l) => l.id === listId)!;
  // A fase inteira, na ordem do quadro: o índice é a prioridade.
  const full = useMemo(() => board.cards.filter((c) => c.listId === listId).sort((a, b) => a.position - b.position), [board.cards, listId]);
  const rank = useMemo(() => new Map(full.map((c, i) => [c.id, i + 1])), [full]);

  const [q, setQ] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [sort, setSort] = useState<Sort>({ by: 'priority', dir: 'asc' });
  const [cols, setCols] = useState<PCol[]>(() => load(COL_KEY, PHASE_DEFAULT, (v) => Array.isArray(v)));
  const [choosingCols, setChoosingCols] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pop, setPop] = useState<null | 'move' | 'due' | 'color'>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);
  useEffect(() => save(COL_KEY, cols), [cols]);

  const shown = PHASE_COLUMNS.filter((c) => c.fixed || cols.includes(c.id));
  const base = full.filter((c) => !match || match.has(c.id));
  const words = fold(q.trim()).split(/\s+/).filter(Boolean);
  const searched = base.filter((c) => {
    if (!words.length) return true;
    const hay = fold(`${c.title} ${c.description} #${c.num}`);
    return words.every((w) => hay.includes(w));
  });
  const rows = searched.filter((c) => chipTest(chip, c, today));
  const sorted = sort.by === 'priority'
    ? (sort.dir === 'asc' ? rows : [...rows].reverse())
    : [...rows].sort((a, b) => (compare(sort.by, a, b) || rank.get(a.id)! - rank.get(b.id)!) * (sort.dir === 'asc' ? 1 : -1));
  const byPriority = sort.by === 'priority' && sort.dir === 'asc';

  // A seleção só guarda tarefas que ainda estão na fase.
  const picked = full.filter((c) => sel.has(c.id));
  const visibleIds = sorted.map((c) => c.id);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => sel.has(id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allVisible ? new Set() : new Set(visibleIds));

  // Esc volta ao quadro (sem janela ou balão aberto e sem estar digitando).
  const popRef = useRef(pop);
  popRef.current = pop;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.scrim')) return;
      if (popRef.current) { setPop(null); return; }
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) { if (t.classList.contains('ph-search')) { setQ(''); t.blur(); } return; }
      onBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onBack]);

  /** Põe a tarefa antes de `beforeId` na ordem da fase (null = no fim). Não entra no log, como arrastar no quadro. */
  const placeBefore = (id: string, beforeId: string | null) => {
    const others = full.filter((c) => c.id !== id);
    const idx = beforeId ? others.findIndex((c) => c.id === beforeId) : -1;
    const position = idx === -1
      ? (others[others.length - 1]?.position ?? 0) + 1
      : idx === 0 ? others[0].position - 1 : (others[idx - 1].position + others[idx].position) / 2;
    const cur = full.findIndex((c) => c.id === id);
    const target = idx === -1 ? others.length : idx;
    if (cur === target) return;
    run(() => post(`/cards/${id}/move`, { listId, position }), undefined, { optimistic: () => changeCard(qc, id, { position }), scope: 'card' });
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const i = full.findIndex((c) => c.id === id);
    if (dir === -1 && i > 0) placeBefore(id, full[i - 1].id);
    if (dir === 1 && i < full.length - 1) placeBefore(id, full[i + 2]?.id ?? null);
  };

  const onRowDragOver = (e: DragEvent, id: string) => {
    if (!dragId) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (dropAt?.id !== id || dropAt.after !== after) setDropAt({ id, after });
  };
  const onRowDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = dragId;
    const target = dropAt;
    setDragId(null);
    setDropAt(null);
    if (!id || !target || target.id === id) return;
    if (!target.after) { placeBefore(id, target.id); return; }
    const i = full.findIndex((c) => c.id === target.id);
    const next = full.slice(i + 1).find((c) => c.id !== id);
    placeBefore(id, next?.id ?? null);
  };

  /** Ação em massa: aviso com o resultado, as puladas (com o motivo) e Desfazer. */
  const bulk = async (body: object, done: (n: number) => string, undo?: (r: BulkResult) => object | null, keepSelection = false) => {
    setBusy(true);
    setPop(null);
    try {
      const r = await post<BulkResult>('/cards/bulk', body);
      await qc.invalidateQueries();
      if (!keepSelection) setSel(new Set());
      const skipped = r.skipped.length
        ? ` ${plural(r.skipped.length, 'ficou de fora', 'ficaram de fora')}: ${r.skipped[0].reason}${r.skipped.length > 1 ? ' (e outras)' : ''}`
        : '';
      const back = r.done.length && undo ? undo(r) : null;
      toast(`${r.done.length ? done(r.done.length) : 'Nenhuma tarefa mudou.'}${skipped}`, r.done.length ? 'ok' : 'error', back ? {
        label: 'Desfazer',
        onClick: () => post('/cards/bulk', back).then(() => qc.invalidateQueries(), (e) => toast((e as Error).message, 'error')),
      } : undefined);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const ids = () => picked.map((c) => c.id);
  const placesOf = (cards: Card[]) => (r: BulkResult) => {
    const items = cards.filter((c) => r.done.includes(c.id)).map((c) => ({ id: c.id, listId: c.listId!, position: c.position }));
    return items.length ? { action: 'place', items } : null;
  };
  const toTop = () => bulk({ action: 'move', ids: ids(), listId, place: 'top' }, (n) => `${plural(n, 'tarefa foi', 'tarefas foram')} para o topo.`, placesOf(picked), true);
  const toEnd = () => bulk({ action: 'move', ids: ids(), listId, place: 'end' }, (n) => `${plural(n, 'tarefa foi', 'tarefas foram')} para o fim.`, placesOf(picked), true);
  const moveTo = (target: string, name: string) => bulk({ action: 'move', ids: ids(), listId: target, place: 'end' }, (n) => `${plural(n, 'tarefa movida', 'tarefas movidas')} para “${name}”.`, placesOf(picked));
  const setDue = (dueDate: string | null) => {
    const before = picked;
    bulk({ action: 'due', items: before.map((c) => ({ id: c.id, dueDate })) }, (n) => dueDate ? `Prazo de ${plural(n, 'tarefa', 'tarefas')} mudado.` : `Prazo tirado de ${plural(n, 'tarefa', 'tarefas')}.`,
      (r) => ({ action: 'due', items: before.filter((c) => r.done.includes(c.id)).map((c) => ({ id: c.id, dueDate: c.dueDate })) }), true);
  };
  const setColor = (color: string | null) => {
    const before = picked;
    bulk({ action: 'color', items: before.map((c) => ({ id: c.id, color })) }, (n) => color ? `Cor de ${plural(n, 'tarefa', 'tarefas')} mudada.` : `Cor tirada de ${plural(n, 'tarefa', 'tarefas')}.`,
      (r) => ({ action: 'color', items: before.filter((c) => r.done.includes(c.id)).map((c) => ({ id: c.id, color: c.color })) }), true);
  };
  const complete = () => bulk({ action: 'complete', ids: ids() }, (n) => `${plural(n, 'tarefa concluída', 'tarefas concluídas')}.`, (r) => ({ action: 'uncomplete', ids: r.done }));
  const archive = () => bulk({ action: 'archive', ids: ids() }, (n) => `${plural(n, 'tarefa arquivada', 'tarefas arquivadas')}.`, (r) => ({ action: 'unarchive', ids: r.done }));
  const discard = async () => {
    await bulk({ action: 'discard', ids: ids() }, (n) => `${plural(n, 'tarefa descartada', 'tarefas descartadas')}.`, (r) => ({ action: 'unarchive', ids: r.done }));
    return true;
  };

  /** Grava no quadro a ordem que está na tela (todas as tarefas da fase, sem os atalhos e a busca). */
  const applyOrder = () => {
    const order = [...full].sort((a, b) => (compare(sort.by, a, b) || rank.get(a.id)! - rank.get(b.id)!) * (sort.dir === 'asc' ? 1 : -1));
    const name = PHASE_COLUMNS.find((c) => c.id === sort.by)?.label.toLowerCase();
    bulk({ action: 'place', items: order.map((c, i) => ({ id: c.id, listId, position: i + 1 })) }, () => `Ordem por ${name} aplicada no quadro.`,
      () => ({ action: 'place', items: full.map((c) => ({ id: c.id, listId, position: c.position })) }), true);
    setSort({ by: 'priority', dir: 'asc' });
  };

  const counts = Object.fromEntries(CHIPS.map((c) => [c.id, searched.filter((x) => chipTest(c.id, x, today)).length])) as Record<Chip, number>;
  const over = list.cardLimit !== null && full.length > list.cardLimit;
  const toggleSort = (by: PCol) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : 'asc' }));

  return (
    <div className="phase-view">
      <div className="ph-bar">
        <button className="b sm" onClick={onBack} title="Voltar ao quadro (Esc)"><span aria-hidden="true">←</span> Voltar ao quadro</button>
        <h2 className="ph-title"><span className="muted">{board.name} /</span> {list.color ? <span className={`ph-tone phase-tone bc-${list.color}`}>{list.name}</span> : list.name}</h2>
        <span className={`ph-count${over ? ' over' : ''}`} title={over ? `Acima do limite de ${list.cardLimit} tarefas` : undefined}>
          {plural(full.length, 'tarefa', 'tarefas')}{list.cardLimit !== null && ` · limite ${list.cardLimit}`}
        </span>
        <span className="grow" />
        <input className="input ph-search" type="search" placeholder="Buscar nesta fase" aria-label="Buscar nesta fase" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="b sm" title="Escolher as colunas da lista" onClick={() => setChoosingCols(true)}><Icon name="columns" />Colunas</button>
        {!byPriority && (
          <button className="b sm" onClick={applyOrder} title="A ordem da fase no quadro passa a ser esta (com Desfazer)">Aplicar esta ordem no quadro</button>
        )}
      </div>
      <div className="ph-bar">
        <div className="ph-chips" role="group" aria-label="Mostrar">
          {CHIPS.map((c) => (
            <button key={c.id} aria-pressed={chip === c.id} className={`ph-chip${chip === c.id ? ' on' : ''}${c.late && counts.late ? ' late' : ''}`} onClick={() => setChip(c.id)}>
              {c.label}<i>{counts[c.id]}</i>
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="hint">{byPriority
          ? 'Arraste as linhas (ou Alt+↑/↓) para mudar a prioridade; clique no número para digitar a posição.'
          : 'Ordem só para olhar: o quadro continua na ordem da prioridade.'}</span>
      </div>
      <ErrorText error={error} />

      {full.length === 0 ? (
        <div className="empty"><b>Fase vazia.</b>Volte ao quadro para criar tarefas nesta fase.</div>
      ) : sorted.length === 0 ? (
        <div className="empty"><b>Nenhuma tarefa.</b>Nenhuma tarefa desta fase atende à busca e ao atalho escolhidos.</div>
      ) : (
        <div className="table-wrap">
          <table className="t tasks phase">
            <thead>
              <tr>
                <th className="c-sel"><input type="checkbox" aria-label="Marcar todas as tarefas da lista" checked={allVisible} onChange={toggleAll} /></th>
                {shown.map((c) => (
                  <th key={c.id} className={`c-${c.id}`} aria-sort={sort.by === c.id ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {c.sort ? (
                      <button className={`th-sort${sort.by === c.id ? ' on' : ''}`} onClick={() => toggleSort(c.id)}>
                        {c.label}{sort.by === c.id && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                      </button>
                    ) : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => {
                const on = sel.has(c.id);
                const mark = dropAt?.id === c.id && dragId !== c.id ? (dropAt.after ? ' drop-after' : ' drop-before') : '';
                return (
                  <tr key={c.id} className={`clickable${on ? ' picked' : ''}${dragId === c.id ? ' dragging' : ''}${mark}${dueTone(c, today)}`} tabIndex={0} data-id={c.id}
                    draggable={byPriority}
                    onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
                    onDragEnd={() => { setDragId(null); setDropAt(null); }}
                    onDragOver={(e) => onRowDragOver(e, c.id)} onDrop={onRowDrop}
                    onClick={() => go(`/tarefa/${c.id}`)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                        e.preventDefault();
                        if (byPriority) nudge(c.id, e.key === 'ArrowUp' ? -1 : 1);
                        else toast('Para mudar a prioridade, volte a ordenar por Prioridade.');
                      } else if (e.key === 'Enter') go(`/tarefa/${c.id}`);
                      else if (e.key === ' ') { e.preventDefault(); toggle(c.id); }
                    }}>
                    <td className="c-sel" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Marcar ${c.title}`} checked={on} onChange={() => toggle(c.id)} />
                    </td>
                    {shown.map((col) => (
                      <td key={col.id} className={`c-${col.id}`}>
                        {col.id === 'priority'
                          ? <PriorityCell cardId={c.id} rank={rank.get(c.id)!} total={full.length} />
                          : cellView(c as Row, col.id, today)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="tbl-foot">
        <span>{sorted.length < full.length ? `${sorted.length} de ${plural(full.length, 'tarefa', 'tarefas')}` : plural(full.length, 'tarefa', 'tarefas')}</span>
        <span className="hint">Clique numa linha para abrir a tarefa; marque as caixinhas para mexer em várias de uma vez. Esc volta ao quadro.</span>
      </div>

      {picked.length > 0 && (
        <div className="bulk-bar" role="toolbar" aria-label="Ações nas tarefas marcadas">
          <b>{plural(picked.length, 'marcada', 'marcadas')}</b>
          <span className="pop-anchor">
            <button disabled={busy} aria-expanded={pop === 'move'} onClick={() => setPop(pop === 'move' ? null : 'move')}>Mover para…</button>
            {pop === 'move' && <Pop onClose={() => setPop(null)}><MovePop boardId={board.id} listId={listId} onPick={moveTo} /></Pop>}
          </span>
          <button disabled={busy} onClick={toTop}>Para o topo</button>
          <button disabled={busy} onClick={toEnd}>Para o fim</button>
          <span className="pop-anchor">
            <button disabled={busy} aria-expanded={pop === 'due'} onClick={() => setPop(pop === 'due' ? null : 'due')}>Prazo…</button>
            {pop === 'due' && <Pop onClose={() => setPop(null)}><DuePop today={today} onPick={setDue} /></Pop>}
          </span>
          <span className="pop-anchor">
            <button disabled={busy} aria-expanded={pop === 'color'} onClick={() => setPop(pop === 'color' ? null : 'color')}>Cor…</button>
            {pop === 'color' && <Pop onClose={() => setPop(null)}><ColorPop onPick={setColor} /></Pop>}
          </span>
          <span className="sp" />
          <button disabled={busy} onClick={complete}>Concluir</button>
          <button disabled={busy} onClick={archive} title="Arquiva as concluídas que você pode arquivar">Arquivar</button>
          <button disabled={busy} className="dg" onClick={() => setConfirmDiscard(true)}>Descartar</button>
          <span className="sp" />
          <button aria-label="Desmarcar todas" title="Desmarcar todas" onClick={() => setSel(new Set())}><Icon name="x" /></button>
        </div>
      )}

      {choosingCols && (
        <ColumnsDialog<PCol> cols={cols} onChange={setCols} onClose={() => setChoosingCols(false)} all={PHASE_COLUMNS} defaults={PHASE_DEFAULT} />
      )}
      {confirmDiscard && (
        <ConfirmDialog title="Descartar tarefas" danger confirm={`Descartar ${plural(picked.length, 'tarefa', 'tarefas')}`}
          text={`Descartar ${plural(picked.length, 'tarefa marcada', 'tarefas marcadas')}? Elas vão para Arquivadas como descartadas, sem concluir, e o aviso traz Desfazer. Ficam de fora as concluídas (use Arquivar), as recebidas por delegação (use Devolver) e as que têm delegação em aberto.`}
          onConfirm={discard} onClose={() => setConfirmDiscard(false)} />
      )}
    </div>
  );
}

/** Prioridade na lista: o número (1º, 2º…); clicar abre a caixa para digitar a nova posição. */
function PriorityCell({ cardId, rank, total }: { cardId: string; rank: number; total: number }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(String(rank));
  const { run } = useAction();
  useEffect(() => setV(String(rank)), [rank]);
  const saveIt = () => {
    setEditing(false);
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < 1 || n === rank) { setV(String(rank)); return; }
    run(() => post(`/cards/${cardId}/priority`, { rank: Math.min(n, total) }), `Tarefa agora é a ${Math.min(n, total)}ª da fase.`);
  };
  if (!editing) {
    return (
      <button className="prio" title="Clique para digitar a nova posição" aria-label={`Prioridade ${rank}ª de ${total}. Clique para mudar.`}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}>{rank}º</button>
    );
  }
  return (
    <input className="input prio-in" type="number" min={1} max={total} value={v} autoFocus aria-label="Nova posição na fase"
      onClick={(e) => e.stopPropagation()} onChange={(e) => setV(e.target.value)} onBlur={saveIt}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(String(rank)); setEditing(false); } }} />
  );
}

function Pop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [onClose]);
  return <div className="bulk-pop" ref={ref}>{children}</div>;
}

function MovePop({ boardId, listId, onPick }: { boardId: string; listId: string; onPick: (listId: string, name: string) => void }) {
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<{ id: string; name: string }[]>('/boards') });
  const [target, setTarget] = useState(boardId);
  const lists = useQuery({ queryKey: ['board', target], queryFn: () => get<Board>(`/boards/${target}`) });
  return (
    <>
      <div className="h">Quadro</div>
      <select className="select input" aria-label="Quadro de destino" value={target} onChange={(e) => setTarget(e.target.value)}>
        {boards.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div className="h">Fase (as tarefas entram no fim)</div>
      {lists.data?.lists.map((l) => (
        <button key={l.id} className="it" disabled={l.id === listId} onClick={() => onPick(l.id, target === boardId ? l.name : `${lists.data!.name} · ${l.name}`)}>
          {l.name}{l.id === listId && ' (esta fase)'}
        </button>
      ))}
    </>
  );
}

function DuePop({ today, onPick }: { today: string; onPick: (d: string | null) => void }) {
  const [d, setD] = useState(today);
  return (
    <>
      <div className="h">Novo prazo</div>
      <input className="input" type="date" aria-label="Novo prazo" value={d} onChange={(e) => setD(e.target.value)} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button className="b sm pri" disabled={!d} onClick={() => onPick(d)}>Aplicar</button>
        <button className="b sm" onClick={() => onPick(null)}>Tirar o prazo</button>
      </div>
    </>
  );
}

function ColorPop({ onPick }: { onPick: (c: string | null) => void }) {
  return (
    <>
      <div className="h">Cor do cartão</div>
      <div className="swatches">
        <button className="sw-opt" onClick={() => onPick(null)}><span className="swatch none" aria-hidden="true" />Sem cor</button>
        {BOARD_COLORS.map((c) => (
          <button key={c.id} className="sw-opt" onClick={() => onPick(c.id)}><span className={`swatch card-tone bc-${c.id}`} aria-hidden="true" />{c.label}</button>
        ))}
      </div>
    </>
  );
}
