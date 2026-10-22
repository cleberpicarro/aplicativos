import { Fragment, useEffect, useRef, useState, type CSSProperties, type DragEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, patch, post, type Board, type Card } from '../lib/api';
import { go } from '../lib/router';
import { cardNo, firstName } from '../lib/format';
import { CardStatusIcon, Dialog, Due, Menu, TipIcon, ErrorText, useMe, useToast } from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Icon } from '../components/Icons';
import { ConfirmDialog, NameDialog, useAction } from '../components/dialogs';
import { ExportTasksDialog, ImportFileDialog } from '../components/ImportExport';
import { asSingle, MAX_BATCH, MAX_TITLE, splitLines } from '../lib/lines';
import { FilterBar, useTaskFilter } from '../components/TaskFilter';
import { addPendingCard, changeCard, isPending } from '../lib/optimistic';
import { NEW_TASK_EVENT, takeNewTaskRequest } from '../lib/shortcuts';

const STORE_KEY = 'synctasks.board';
const ZOOM_KEY = 'synctasks.zoom';

/** Item 34: zoom do quadro, de 70% a 130%, guardado neste computador. */
export const ZOOM_MIN = 70;
export const ZOOM_MAX = 130;
const ZOOM_STEP = 10;

function rememberedZoom(): number {
  try {
    const z = Number(localStorage.getItem(ZOOM_KEY));
    return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 100;
  } catch { return 100; }
}

/** Último quadro aberto neste computador (também usado pela busca: “12” abre a tarefa 12 dele). */
export function rememberedBoard(): string | null {
  try { return localStorage.getItem(STORE_KEY) ?? localStorage.getItem('nerus.board'); } catch { return null; }
}

/** Cores de fundo do quadro (item 12). Os tons de cada uma, nos dois temas, estão em styles.css (.bc-*). */
export const BOARD_COLORS: { id: string; label: string }[] = [
  { id: 'azul', label: 'Azul' }, { id: 'verde', label: 'Verde' }, { id: 'amarelo', label: 'Amarelo' }, { id: 'laranja', label: 'Laranja' },
  { id: 'vermelho', label: 'Vermelho' }, { id: 'roxo', label: 'Roxo' }, { id: 'rosa', label: 'Rosa' }, { id: 'cinza', label: 'Cinza' },
];

/** Item 24: fundo da área de trabalho. Os tons de cada cor, nos dois temas, estão em styles.css (.ws-*). */
export const WORKSPACE_COLORS: { id: string; label: string }[] = [
  { id: 'cinza-azulado', label: 'Cinza-azulado' }, { id: 'azul', label: 'Azul' }, { id: 'verde-agua', label: 'Verde-água' },
  { id: 'verde', label: 'Verde' }, { id: 'areia', label: 'Areia' }, { id: 'lilas', label: 'Lilás' }, { id: 'rosa', label: 'Rosa' },
];

type BoardTab = { id: string; name: string; color: string | null; position: number };

/** `top`: espaço na barra do topo para os botões do filtro (item 59); sem ele, ficam na linha acima das fases. */
export function BoardsPage({ top }: { top?: HTMLElement | null } = {}) {
  const me = useMe().data!;
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<BoardTab[]>('/boards') });
  const [selected, setSelected] = useState<string | null>(rememberedBoard);
  const [dialog, setDialog] = useState<null | 'newBoard' | 'renameBoard' | 'newList' | 'import' | 'export' | 'color' | 'workspace' | 'archiveBoard'>(null);
  const toast = useToast();
  const { run, error } = useAction();
  const qc = useQueryClient();
  const [dragTab, setDragTab] = useState<string | null>(null);
  const [tabDrop, setTabDrop] = useState<{ id: string; after: boolean } | null>(null);
  const [zoom, setZoomState] = useState(rememberedZoom);
  const setZoom = (z: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    setZoomState(next);
    try { localStorage.setItem(ZOOM_KEY, String(next)); } catch { /* sem armazenamento: só não lembra */ }
  };
  const boardId = boards.data?.some((b) => b.id === selected) ? selected! : boards.data?.[0]?.id;
  // O quadro se atualiza sozinho a cada 30 segundos enquanto está na tela: o que foi mudado em outro
  // aparelho (cor, número, conclusão, tarefa delegada que chegou) aparece sem precisar recarregar a página.
  const board = useQuery({ queryKey: ['board', boardId], queryFn: () => get<Board>(`/boards/${boardId}`), enabled: !!boardId, refetchInterval: 30_000 });
  // Item 47: o mesmo filtro da tabela, no quadro aberto. O servidor diz quais tarefas do quadro atendem a ele.
  const filter = useTaskFilter();
  const match = useQuery({
    queryKey: ['board-match', boardId, filter.param],
    queryFn: () => get<{ ids: string[]; ignored: boolean }>(`/boards/${boardId}/match?filter=${filter.param}`),
    enabled: !!boardId && filter.active,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const matchIds = filter.active && match.data ? new Set(match.data.ids) : null;
  useHiddenNotice(board, match, matchIds);

  const select = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(STORE_KEY, id); } catch { /* sem armazenamento: só não lembra */ }
  };

  /** Item 26: grava a nova ordem; a aba já aparece no lugar novo antes da resposta do servidor. */
  const placeBoard = (id: string, beforeId: string | null) => {
    const list = (boards.data ?? []).filter((b) => b.id !== id);
    const idx = beforeId ? list.findIndex((b) => b.id === beforeId) : -1;
    const position = idx === -1
      ? (list[list.length - 1]?.position ?? 0) + 1
      : idx === 0 ? list[0].position - 1 : (list[idx - 1].position + list[idx].position) / 2;
    const current = boards.data?.find((b) => b.id === id);
    if (!current) return;
    const order = [...list.slice(0, idx === -1 ? list.length : idx), { ...current, position }, ...(idx === -1 ? [] : list.slice(idx))];
    const before = boards.data!.map((b) => b.id).join();
    if (order.map((b) => b.id).join() === before) return;
    qc.setQueryData(['boards'], order);
    run(() => patch(`/boards/${id}`, { position }));
  };
  const moveBoard = (dir: -1 | 1) => {
    const list = boards.data ?? [];
    const i = list.findIndex((b) => b.id === boardId);
    if (dir === -1 && i > 0) placeBoard(list[i].id, list[i - 1].id);
    if (dir === 1 && i < list.length - 1) placeBoard(list[i].id, list[i + 2]?.id ?? null);
  };
  const dropTab = () => {
    const id = dragTab;
    const target = tabDrop;
    setDragTab(null);
    setTabDrop(null);
    if (!id || !target) return;
    const list = boards.data ?? [];
    const i = list.findIndex((b) => b.id === target.id);
    placeBoard(id, target.after ? list[i + 1]?.id ?? null : target.id);
  };
  const boardIndex = boards.data?.findIndex((b) => b.id === boardId) ?? -1;

  if (!me.user.inHierarchy) {
    return <div className="page"><div className="empty">Administradores fora da hierarquia não têm quadros.</div></div>;
  }

  return (
    <div className="page wide">
      <div className="tabs" role="tablist" aria-label="Quadros">
        {boards.data?.map((b) => (
          <button key={b.id} role="tab" aria-selected={b.id === boardId} onClick={() => select(b.id)}
            className={`tab${dragTab === b.id ? ' dragging' : ''}${tabDrop?.id === b.id && dragTab !== b.id ? (tabDrop.after ? ' drop-after' : ' drop-before') : ''}`}
            draggable={(boards.data?.length ?? 0) > 1} title={(boards.data?.length ?? 0) > 1 ? 'Arraste para mudar a ordem dos quadros' : undefined}
            onDragStart={(e) => { setDragTab(b.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', b.id); }}
            onDragEnd={() => { setDragTab(null); setTabDrop(null); }}
            onDragOver={(e) => {
              if (!dragTab) return;
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientX > r.left + r.width / 2;
              if (tabDrop?.id !== b.id || tabDrop.after !== after) setTabDrop({ id: b.id, after });
            }}
            onDrop={(e) => { e.preventDefault(); dropTab(); }}>
            {b.color && <span className={`swatch bc-${b.color}`} aria-hidden="true" />}{b.name}
          </button>
        ))}
        <span className="tabs-side">
          {board.data && (
            <span className="zoom" role="group" aria-label="Zoom do quadro">
              <button className="b ghost sm quiet" aria-label="Diminuir o zoom" title="Diminuir o zoom"
                disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(zoom - ZOOM_STEP)}>−</button>
              <button className="b ghost sm quiet zoom-val" aria-label={`Zoom em ${zoom}%; clique para voltar a 100%`} title="Voltar a 100%"
                onClick={() => setZoom(100)}>{zoom}%</button>
              <button className="b ghost sm quiet" aria-label="Aumentar o zoom" title="Aumentar o zoom"
                disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(zoom + ZOOM_STEP)}>+</button>
            </span>
          )}
          <button className="b ghost sm quiet" onClick={() => setDialog('newBoard')}><Icon name="plus" />Quadro</button>
          {boards.data && (
            <Menu label="Opções do quadro" items={[
              ...(board.data ? [
                { label: 'Renomear quadro', onClick: () => setDialog('renameBoard') },
                { label: 'Cor do quadro', onClick: () => setDialog('color') },
                { label: 'Nova fase', onClick: () => setDialog('newList') },
                { label: 'Mover quadro para a esquerda', onClick: () => moveBoard(-1), disabled: boardIndex <= 0 },
                { label: 'Mover quadro para a direita', onClick: () => moveBoard(1), disabled: boardIndex === (boards.data?.length ?? 0) - 1 },
                { label: 'Fundo da área de trabalho', onClick: () => setDialog('workspace') },
              ] : []),
              // Itens 31 e 62: importar e exportar ficam juntos no fim do menu.
              { label: 'Importar arquivo JSON', onClick: () => setDialog('import'), separator: !!board.data },
              ...(boards.data.length ? [{ label: 'Exportar tarefas (JSON)', onClick: () => setDialog('export') }] : []),
              // Item 42: arquivar quadro vazio, separado no fim.
              ...(board.data ? [{ label: 'Arquivar quadro', danger: true, separator: true, onClick: () => {
                const n = board.data!.cards.length;
                if (n) toast(`Este quadro ainda tem ${n === 1 ? '1 tarefa' : `${n} tarefas`}: arquive as concluídas ou mova as abertas para outro quadro.`, 'error');
                else if ((boards.data?.length ?? 0) < 2) toast('Este é o seu único quadro. Crie outro quadro antes de arquivar este.', 'error');
                else setDialog('archiveBoard');
              } }] : []),
            ]} />
          )}
        </span>
      </div>
      <ErrorText error={error} />

      {boards.data && boards.data.length === 0 && (
        <div className="empty"><b>Você ainda não tem quadros.</b>Crie o primeiro e escolha as fases que fizerem sentido para você.</div>
      )}
      {board.data && <FilterBar f={filter} onBoard top={top} />}
      {board.data && matchIds && (
        <div className="filter-band" role="status">
          <Icon name="filter" />
          <span>Filtro ligado: mostrando <b>{board.data.cards.filter((c) => matchIds.has(c.id)).length}</b> de {board.data.cards.length} {board.data.cards.length === 1 ? 'tarefa' : 'tarefas'} deste quadro.</span>
          {match.data?.ignored && <span className="hint">As condições “Quadro” e “Arquivada” não valem dentro do quadro e foram ignoradas.</span>}
          <button className="b sm" onClick={filter.clear}>Limpar filtro</button>
        </div>
      )}
      {board.isLoading && <p className="loading">Carregando o quadro…</p>}
      {board.data && <Kanban board={board.data} today={me.today} zoom={zoom} match={matchIds} onNewList={() => setDialog('newList')} />}

      {dialog === 'newBoard' && (
        <NameDialog title="Novo quadro" label="Nome do quadro" confirm="Criar" onClose={() => setDialog(null)}
          onSave={async (name) => { const b = await post<{ id: string }>('/boards', { name }); select(b.id); return b; }} />
      )}
      {dialog === 'import' && (
        <ImportFileDialog onClose={() => setDialog(null)}
          onImported={(id, n) => { select(id); setDialog(null); toast(n === 1 ? 'Quadro importado.' : `${n} quadros importados.`); }} />
      )}
      {dialog === 'export' && <ExportTasksDialog onClose={() => setDialog(null)} />}
      {dialog === 'renameBoard' && board.data && (
        <NameDialog title="Renomear quadro" label="Nome do quadro" confirm="Salvar" initial={board.data.name} onClose={() => setDialog(null)}
          onSave={(name) => patch(`/boards/${board.data!.id}`, { name })} />
      )}
      {dialog === 'newList' && board.data && (
        <NameDialog title="Nova fase" label="Nome da fase" confirm="Criar" onClose={() => setDialog(null)}
          onSave={(name) => post(`/boards/${board.data!.id}/lists`, { name })} />
      )}
      {dialog === 'color' && board.data && <ColorDialog board={board.data} onClose={() => setDialog(null)} />}
      {dialog === 'archiveBoard' && board.data && (
        <ConfirmDialog title="Arquivar quadro" danger confirm="Arquivar quadro" onClose={() => setDialog(null)}
          text={`Arquivar o quadro “${board.data.name}”? Ele sai das abas, com as fases. As tarefas arquivadas dele continuam em Arquivadas, e o quadro pode ser desarquivado por lá.`}
          onConfirm={async () => {
            const id = board.data!.id;
            const name = board.data!.name;
            const r = await post(`/boards/${id}/archive`);
            toast(`Quadro “${name}” arquivado.`, 'ok', {
              label: 'Desfazer',
              onClick: () => post(`/boards/${id}/unarchive`, { back: 'same' }).then(() => { select(id); return qc.invalidateQueries(); }, (e) => toast((e as Error).message, 'error')),
            });
            return r;
          }} />
      )}
      {dialog === 'workspace' && <WorkspaceDialog current={me.prefs.workspaceBg} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ColorDialog({ board, onClose }: { board: Board; onClose: () => void }) {
  const { run, error } = useAction();
  const pick = async (color: string | null) => {
    if ((await run(() => patch(`/boards/${board.id}`, { color }))) !== undefined) onClose();
  };
  return (
    <Dialog title="Cor do quadro" onClose={onClose}>
      <p className="hint" style={{ margin: 0 }}>A cor fica no quadro “{board.name}” e aparece em qualquer computador.</p>
      <div className="swatches" role="radiogroup" aria-label="Cor do quadro">
        <button role="radio" aria-checked={!board.color} className="sw-opt" onClick={() => pick(null)}>
          <span className="swatch big none" aria-hidden="true" />Padrão
        </button>
        {BOARD_COLORS.map((c) => (
          <button key={c.id} role="radio" aria-checked={board.color === c.id} className="sw-opt" onClick={() => pick(c.id)}>
            <span className={`swatch big bc-${c.id}`} aria-hidden="true" />{c.label}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
    </Dialog>
  );
}

function WorkspaceDialog({ current, onClose }: { current: string | null; onClose: () => void }) {
  const { run, error } = useAction();
  const pick = async (workspaceBg: string | null) => {
    if ((await run(() => patch('/me/prefs', { workspaceBg }))) !== undefined) onClose();
  };
  return (
    <Dialog title="Fundo da área de trabalho" onClose={onClose}>
      <p className="hint" style={{ margin: 0 }}>Vale para todas as telas e fica guardado na sua conta (aparece em qualquer computador). No tema escuro, cada cor tem uma versão escura.</p>
      <div className="swatches" role="radiogroup" aria-label="Fundo da área de trabalho">
        <button role="radio" aria-checked={!current} className="sw-opt" onClick={() => pick(null)}>
          <span className="swatch big none" aria-hidden="true" />Padrão (branco)
        </button>
        {WORKSPACE_COLORS.map((c) => (
          <button key={c.id} role="radio" aria-checked={current === c.id} className="sw-opt" onClick={() => pick(c.id)}>
            <span className={`swatch big ws-${c.id}`} style={{ background: 'var(--ws)' }} aria-hidden="true" />{c.label}
          </button>
        ))}
      </div>
      <ErrorText error={error} />
    </Dialog>
  );
}

const SORTS: { by: 'title' | 'created' | 'due'; label: string; done: string }[] = [
  { by: 'title', label: 'Ordenar por nome (A–Z)', done: 'por nome' },
  { by: 'created', label: 'Ordenar por data de criação', done: 'por data de criação' },
  { by: 'due', label: 'Ordenar por prazo', done: 'por prazo' },
];

type DropAt = { listId: string; beforeId: string | null } | null;

/**
 * Item 47: avisa quando uma tarefa some do quadro por causa do filtro ligado: ao ser concluída num filtro de abertas,
 * ou ao ser criada sem atender ao filtro. Só compara quando a resposta do filtro é mais nova que a do quadro.
 */
function useHiddenNotice(board: { data?: Board; dataUpdatedAt: number }, match: { data?: { ids: string[] }; dataUpdatedAt: number; isFetching: boolean }, matchIds: Set<string> | null) {
  const toast = useToast();
  const last = useRef<{ boardId: string; ids: Set<string>; visible: Set<string> } | null>(null);
  useEffect(() => {
    const b = board.data;
    if (!b || !matchIds) { last.current = null; return; }
    if (match.isFetching || match.dataUpdatedAt < board.dataUpdatedAt) return;
    const ids = new Set(b.cards.map((c) => c.id));
    const visible = new Set(b.cards.filter((c) => matchIds.has(c.id)).map((c) => c.id));
    const prev = last.current;
    last.current = { boardId: b.id, ids, visible };
    if (!prev || prev.boardId !== b.id) return;
    const gone = b.cards.filter((c) => !visible.has(c.id) && (prev.visible.has(c.id) || !prev.ids.has(c.id)));
    if (gone.length === 1) toast(`A tarefa “${gone[0].title}” não aparece agora: ela não atende ao filtro ligado.`);
    else if (gone.length > 1) toast(`${gone.length} tarefas não aparecem agora: elas não atendem ao filtro ligado.`);
  }, [board.data, board.dataUpdatedAt, match.data, match.dataUpdatedAt, match.isFetching, matchIds, toast]);
}

function Kanban({ board, today, zoom, match, onNewList }: { board: Board; today: string; zoom: number; match: Set<string> | null; onNewList: () => void }) {
  const { run, error } = useAction();
  const qc = useQueryClient();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);

  const allOf = (listId: string) => board.cards.filter((c) => c.listId === listId);
  // Com filtro ligado, os cartões que não atendem a ele ficam escondidos; as fases continuam todas no lugar.
  const cardsOf = (listId: string) => allOf(listId).filter((c) => !match || match.has(c.id)).sort((a, b) => a.position - b.position);

  /** Item 10: decide se a tarefa entra antes ou depois do cartão, pela metade em que o mouse está. */
  const overCard = (e: DragEvent, listId: string, cardId: string) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const list = cardsOf(listId);
    const i = list.findIndex((c) => c.id === cardId);
    const beforeId = e.clientY < rect.top + rect.height / 2 ? cardId : list[i + 1]?.id ?? null;
    if (dropAt?.listId !== listId || dropAt.beforeId !== beforeId) setDropAt({ listId, beforeId });
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = dragId ?? e.dataTransfer.getData('text/plain');
    const target = dropAt;
    setDragId(null);
    setDropAt(null);
    if (!id || !target) return;
    const list = cardsOf(target.listId).filter((c) => c.id !== id);
    const idx = target.beforeId ? list.findIndex((c) => c.id === target.beforeId) : -1;
    const position = idx === -1
      ? (list[list.length - 1]?.position ?? 0) + 1
      : idx === 0 ? list[0].position - 1 : (list[idx - 1].position + list[idx].position) / 2;
    const current = board.cards.find((c) => c.id === id);
    const unchanged = current && current.listId === target.listId &&
      cardsOf(target.listId).findIndex((c) => c.id === id) === (idx === -1 ? cardsOf(target.listId).length - 1 : idx);
    if (unchanged) return;
    // Item 54: o cartão já fica onde foi solto; se o servidor recusar, volta para o lugar de antes.
    run(() => post(`/cards/${id}/move`, { listId: target.listId, position }), undefined,
      { optimistic: () => changeCard(qc, id, { listId: target.listId, position }), scope: 'card' });
  };

  const moveList = (index: number, dir: -1 | 1) => {
    const lists = board.lists;
    const target = index + dir;
    if (target < 0 || target >= lists.length) return;
    const neighbor = lists[target];
    const beyond = lists[target + dir];
    const position = beyond ? (neighbor.position + beyond.position) / 2 : neighbor.position + dir;
    run(() => patch(`/lists/${lists[index].id}`, { position }));
  };

  /** Item 23: arquiva as concluídas da fase, com “Desfazer” no aviso. */
  const archiveDone = async (listId: string, name: string) => {
    const r = await run(() => post<{ archived: number; ids: string[] }>(`/lists/${listId}/archive-done`));
    if (!r) return;
    if (!r.archived) { toast('Nenhuma tarefa concluída para arquivar nesta fase.'); return; }
    toast(`${r.archived === 1 ? '1 tarefa concluída arquivada' : `${r.archived} tarefas concluídas arquivadas`} em “${name}”.`, 'ok', {
      label: 'Desfazer',
      onClick: () => run(async () => { for (const id of r.ids) await post(`/cards/${id}/unarchive`); }, r.archived === 1 ? 'Tarefa de volta ao quadro.' : 'Tarefas de volta ao quadro.'),
    });
  };

  const line = <div className="drop-line" aria-hidden="true" />;

  return (
    <div className={`board-area${board.color ? ` colored bc-${board.color}` : ''}`}>
      <ErrorText error={error} />
      <div className="kanban" style={{ '--zoom': zoom / 100 } as CSSProperties}>
        {board.lists.map((l, i) => {
          const cards = cardsOf(l.id);
          const all = allOf(l.id);
          const here = dropAt?.listId === l.id;
          return (
            <section key={l.id} className={`col${here ? ' over' : ''}`} aria-label={l.name}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                // No vão entre dois cartões, mantém a linha onde está; abaixo do último, vai para o fim.
                if (here && cards.length && (e.target as HTMLElement).closest('.col-list')) {
                  const last = (e.currentTarget.querySelector('.col-list .kc:last-of-type') as HTMLElement | null)?.getBoundingClientRect();
                  if (!last || e.clientY < last.bottom) return;
                }
                if (!here || dropAt?.beforeId !== null) setDropAt({ listId: l.id, beforeId: null });
              }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && here) setDropAt(null); }}
              onDrop={drop}>
              <div className="col-h">
                <b title={l.name}>{l.name}</b>
                <span className="n" title={match ? 'Tarefas que atendem ao filtro, do total da fase' : undefined}>{match ? `${cards.length} de ${all.length}` : cards.length}</span>
                <Menu label={`Opções da fase ${l.name}`} items={[
                  ...SORTS.map((s) => ({ label: s.label, onClick: () => run(() => post(`/lists/${l.id}/sort`, { by: s.by }), `Fase “${l.name}” ordenada ${s.done}.`), disabled: all.length < 2 })),
                  { label: 'Arquivar as concluídas', onClick: () => archiveDone(l.id, l.name), disabled: !all.some(archivable) },
                  { label: 'Renomear fase', onClick: () => setRenaming({ id: l.id, name: l.name }) },
                  { label: 'Mover fase para a esquerda', onClick: () => moveList(i, -1), disabled: i === 0 },
                  { label: 'Mover fase para a direita', onClick: () => moveList(i, 1), disabled: i === board.lists.length - 1 },
                  { label: all.length ? 'Arquivar fase (mova as tarefas antes)' : 'Arquivar fase', onClick: () => all.length ? toast('Mova as tarefas desta fase antes de arquivá-la.', 'error') : setArchiving({ id: l.id, name: l.name }), danger: true },
                ]} />
              </div>
              <div className="col-list">
                {cards.map((c) => (
                  <Fragment key={c.id}>
                    {here && dropAt?.beforeId === c.id && line}
                    <Tile card={c} today={today} dragging={dragId === c.id}
                      onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); }}
                      onDragEnd={() => { setDragId(null); setDropAt(null); }}
                      onDragOver={(e) => overCard(e, l.id, c.id)}
                      onDrop={drop} />
                  </Fragment>
                ))}
                {here && dropAt?.beforeId === null && line}
              </div>
              <AddCard listId={l.id} first={i === 0} />
            </section>
          );
        })}
        <div className="add-col">
          <button className="add-card" style={{ margin: 0 }} onClick={onNewList}><Icon name="plus" />Nova fase</button>
        </div>
      </div>
      <p className="hint">Arraste as tarefas para mudar a ordem ou a fase, e as abas para mudar a ordem dos quadros; a linha azul mostra onde vai entrar. No celular, abra a tarefa e use “Mover para”.</p>

      {renaming && (
        <NameDialog title="Renomear fase" label="Nome da fase" confirm="Salvar" initial={renaming.name} onClose={() => setRenaming(null)}
          onSave={(name) => patch(`/lists/${renaming.id}`, { name })} />
      )}
      {archiving && (
        <ConfirmDialog title="Arquivar fase" confirm="Arquivar" danger text={`Arquivar a fase “${archiving.name}”? Ela está vazia e deixa de aparecer no quadro.`}
          onConfirm={() => post(`/lists/${archiving.id}/archive`)} onClose={() => setArchiving(null)} />
      )}
    </div>
  );
}

function Tile({ card, today, dragging, onDragStart, onDragEnd, onDragOver, onDrop }: {
  card: Card; today: string; dragging: boolean;
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void; onDragOver: (e: DragEvent) => void; onDrop: (e: DragEvent) => void;
}) {
  const { run } = useAction();
  const qc = useQueryClient();
  const d = card.delegation;
  const done = !!card.completedAt;
  const pending = isPending(card);
  const canToggle = !pending && (!d || d.status === 'IN_PROGRESS' || d.status === 'AWAITING_ACK');
  const toggle = () =>
    run(() => post(`/cards/${card.id}/${done ? 'uncomplete' : 'complete'}`),
      done ? 'Conclusão desfeita.' : d ? `Concluída. ${firstName(d.delegatorName)} foi avisado(a) para dar o ciente.` : 'Tarefa concluída.',
      { optimistic: () => changeCard(qc, card.id, { completedAt: done ? null : new Date().toISOString() }), scope: 'card' });
  const showStatus = d && (d.status === 'AWAITING_ACK' || d.reopened);
  const toast = useToast();
  const archive = async () => {
    if ((await run(() => post(`/cards/${card.id}/archive`), undefined, { optimistic: () => changeCard(qc, card.id, null), scope: 'card' })) === undefined) return;
    toast('Tarefa arquivada.', 'ok', { label: 'Desfazer', onClick: () => run(() => post(`/cards/${card.id}/unarchive`), 'Tarefa de volta ao quadro.') });
  };
  return (
    <article data-id={pending ? undefined : card.id} aria-busy={pending || undefined}
      className={`kc${done ? ' done' : ''}${dragging ? ' dragging' : ''}${pending ? ' pending' : ''}${card.color ? ` painted bc-${card.color}` : ''}`} draggable={!pending} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop}>
      <button className={`ck${done ? ' on' : ''}`} onClick={toggle} disabled={!canToggle} aria-label={done ? `Desfazer conclusão de ${card.title}` : `Concluir ${card.title}`}>
        {done && <Icon name="check" />}
      </button>
      <button className="t" onClick={() => go(`/tarefa/${card.id}`)} title={card.title} disabled={pending}>{card.title}</button>
      <div className="meta">
        <span className="code">{pending ? 'criando…' : cardNo(card.num)}</span>
        <Due date={card.dueDate} done={done} today={today} />
        {card.checklist.total > 0 && <span className="cl" title="Checklist"><Icon name="checks" />{card.checklist.done}/{card.checklist.total}</span>}
        {/* Opção A do ícone de delegada: etiqueta com o nome (roxa = recebida de alguém; verde-azulada = você delegou). */}
        {d && <span className="dtag from" title={`Delegada por ${d.delegatorName}`}><Icon name="into" />De {firstName(d.delegatorName)}</span>}
        {card.child && !['CANCELED'].includes(card.child.status) && (
          <span className="dtag to" title={`Repassada para ${card.child.ownerName}`}><Icon name="out" />Para {firstName(card.child.ownerName)}</span>
        )}
        {card.isPrivate && <TipIcon name="lock" tip="Privada: nenhum superior vê" />}
        {d?.noPass && <TipIcon name="self" tip={`Não pode ser repassada: ${firstName(d.delegatorName)} pediu que você mesmo faça`} />}
        {card.child?.noPass && !['ACKED', 'CANCELED'].includes(card.child.status) && <TipIcon name="self" tip={`Não pode ser repassada por ${firstName(card.child.ownerName)}`} />}
        {showStatus && <CardStatusIcon card={card} />}
        {archivable(card) && (
          <button className="arch" onClick={archive} aria-label={`Arquivar ${card.title}`} data-tip="Arquivar">
            <Icon name="archive" />
          </button>
        )}
      </div>
    </article>
  );
}

/** Item 23: só a tarefa própria concluída e sem delegação para baixo em aberto. A recebida por delegação é arquivada pelo ciente. */
function archivable(c: Card) {
  return !!c.completedAt && !c.delegation && !(c.child && ['PENDING_ACCEPT', 'IN_PROGRESS', 'AWAITING_ACK', 'DECLINED'].includes(c.child.status));
}

function AddCard({ listId, first }: { listId: string; first?: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  // Item 56: a tecla N abre a criação de tarefa na primeira fase do quadro.
  useEffect(() => {
    if (!first) return;
    const onNew = () => { takeNewTaskRequest(); setOpen(true); };
    window.addEventListener(NEW_TASK_EVENT, onNew);
    if (takeNewTaskRequest()) setOpen(true);
    return () => window.removeEventListener(NEW_TASK_EVENT, onNew);
  }, [first]);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState<string[] | null>(null);
  const { run, busy, error, setError } = useAction();
  const toast = useToast();
  useEffect(() => { if (!open) { setText(''); setAsking(null); } }, [open]);

  const done = () => { setText(''); setAsking(null); };
  const tooLong = (titles: string[]) => {
    const long = titles.find((t) => t.length > MAX_TITLE);
    if (long) setError(new Error(`Cada título pode ter até ${MAX_TITLE} caracteres. Encurte: “${long.slice(0, 40)}…”`));
    return !!long;
  };
  const createOne = async () => {
    const { title, description } = asSingle(text);
    if (tooLong([title])) { setAsking(null); return; }
    if (await run(() => post('/cards', { listId, title, description }))) done();
  };
  const createMany = async (titles: string[]) => {
    if (tooLong(titles)) { setAsking(null); return; }
    const r = await run(() => post<{ cards: { id: string }[] }>('/cards/batch', { listId, titles }));
    if (!r) return;
    done();
    const ids = r.cards.map((c) => c.id);
    toast(`${ids.length} tarefas criadas.`, 'ok', {
      label: 'Desfazer',
      onClick: () => run(() => post('/cards/undo-create', { ids }), 'Criação desfeita.'),
    });
  };
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const lines = splitLines(text);
    if (!lines.length) { setOpen(false); return; }
    if (lines.length === 1) {
      if (tooLong(lines)) return;
      // Item 54: o cartão aparece na hora (como “criando…”) e o campo já fica livre para a próxima tarefa.
      const title = lines[0];
      setText('');
      void run(() => post('/cards', { listId, title }), undefined, { optimistic: () => addPendingCard(qc, listId, title), scope: 'card' })
        .then((r) => { if (!r) setText(title); });
      return;
    }
    setAsking(lines);
  };

  if (!open) return <button className="add-card" onClick={() => setOpen(true)}><Icon name="plus" />Adicionar tarefa</button>;
  return (
    <form className="add-form" onSubmit={submit}>
      <textarea className="input add-text" autoFocus rows={1} value={text} placeholder="Título da tarefa" aria-label="Título da nova tarefa"
        onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight + 2}px`; }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
        }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="b pri sm" type="submit" disabled={busy}>Adicionar</button>
        <button className="b ghost sm" type="button" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      <ErrorText error={error} />
      {asking && <ManyLinesDialog titles={asking} busy={busy} onOne={createOne} onMany={() => createMany(asking)} onClose={() => setAsking(null)} />}
    </form>
  );
}

/** Item 30: o texto tem várias linhas. Pergunta se vira uma tarefa só ou uma por linha. */
function ManyLinesDialog({ titles, busy, onOne, onMany, onClose }: { titles: string[]; busy: boolean; onOne: () => void; onMany: () => void; onClose: () => void }) {
  const n = titles.length;
  const over = n > MAX_BATCH;
  const many = useRef<HTMLButtonElement>(null);
  const one = useRef<HTMLButtonElement>(null);
  // Enter confirma a opção principal (o Dialog foca o primeiro botão; este efeito roda depois do dele).
  useEffect(() => { (over ? one : many).current?.focus(); }, [over]);
  return (
    <Dialog title={`O texto tem ${n} linhas`} onClose={onClose}
      footer={<>
        <button type="button" className="b" onClick={onClose}>Cancelar</button>
        <button ref={one} type="button" className="b" onClick={onOne} disabled={busy}>Criar 1 tarefa</button>
        <button ref={many} type="button" className="b pri" onClick={onMany} disabled={busy || over}>Criar {n} tarefas</button>
      </>}>
      <p style={{ marginTop: 0 }}>Quer criar <b>uma tarefa por linha</b> ou <b>uma tarefa só</b>, com a primeira linha como título e o resto na descrição?</p>
      {over && <p className="err">Dá para criar até {MAX_BATCH} tarefas de uma vez. Divida o texto ou crie uma tarefa só.</p>}
      <ol className="lines-preview" aria-label="Tarefas que serão criadas">
        {titles.map((t, i) => <li key={i}>{t}</li>)}
      </ol>
    </Dialog>
  );
}
