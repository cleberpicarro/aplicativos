import { Fragment, useEffect, useState, type DragEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, patch, post, type Board, type Card } from '../lib/api';
import { go } from '../lib/router';
import { firstName } from '../lib/format';
import { CardStatusIcon, Dialog, Due, Menu, TipIcon, ErrorText, useMe, useToast } from '../components/ui';
import { Icon } from '../components/Icons';
import { ConfirmDialog, NameDialog, useAction } from '../components/dialogs';
import { ImportTrelloDialog } from '../components/ImportTrello';

const STORE_KEY = 'synctasks.board';

function rememberedBoard(): string | null {
  try { return localStorage.getItem(STORE_KEY) ?? localStorage.getItem('nerus.board'); } catch { return null; }
}

/** Cores de fundo do quadro (item 12). Os tons de cada uma, nos dois temas, estão em styles.css (.bc-*). */
export const BOARD_COLORS: { id: string; label: string }[] = [
  { id: 'azul', label: 'Azul' }, { id: 'verde', label: 'Verde' }, { id: 'amarelo', label: 'Amarelo' }, { id: 'laranja', label: 'Laranja' },
  { id: 'vermelho', label: 'Vermelho' }, { id: 'roxo', label: 'Roxo' }, { id: 'rosa', label: 'Rosa' }, { id: 'cinza', label: 'Cinza' },
];

export function BoardsPage() {
  const me = useMe().data!;
  const boards = useQuery({ queryKey: ['boards'], queryFn: () => get<{ id: string; name: string; color: string | null }[]>('/boards') });
  const [selected, setSelected] = useState<string | null>(rememberedBoard);
  const [dialog, setDialog] = useState<null | 'newBoard' | 'renameBoard' | 'newList' | 'import' | 'color'>(null);
  const toast = useToast();
  const boardId = boards.data?.some((b) => b.id === selected) ? selected! : boards.data?.[0]?.id;
  const board = useQuery({ queryKey: ['board', boardId], queryFn: () => get<Board>(`/boards/${boardId}`), enabled: !!boardId });

  const select = (id: string) => {
    setSelected(id);
    try { localStorage.setItem(STORE_KEY, id); } catch { /* sem armazenamento: só não lembra */ }
  };

  if (!me.user.inHierarchy) {
    return <div className="page"><div className="empty">Administradores fora da hierarquia não têm quadros.</div></div>;
  }

  return (
    <div className="page wide">
      <div className="tabs" role="tablist" aria-label="Quadros">
        {boards.data?.map((b) => (
          <button key={b.id} role="tab" className="tab" aria-selected={b.id === boardId} onClick={() => select(b.id)}>
            {b.color && <span className={`swatch bc-${b.color}`} aria-hidden="true" />}{b.name}
          </button>
        ))}
        <span className="tabs-side">
          <button className="b ghost sm quiet" onClick={() => setDialog('newBoard')}><Icon name="plus" />Quadro</button>
          <button className="b ghost sm quiet" onClick={() => setDialog('import')} title="Cria um quadro novo a partir de um quadro exportado do Trello">Importar do Trello</button>
          {board.data && (
            <Menu label="Opções do quadro" items={[
              { label: 'Renomear quadro', onClick: () => setDialog('renameBoard') },
              { label: 'Cor do quadro', onClick: () => setDialog('color') },
              { label: 'Nova fase', onClick: () => setDialog('newList') },
            ]} />
          )}
        </span>
      </div>

      {boards.data && boards.data.length === 0 && (
        <div className="empty"><b>Você ainda não tem quadros.</b>Crie o primeiro e escolha as fases que fizerem sentido para você.</div>
      )}
      {board.isLoading && <p className="loading">Carregando o quadro…</p>}
      {board.data && <Kanban board={board.data} today={me.today} onNewList={() => setDialog('newList')} />}

      {dialog === 'newBoard' && (
        <NameDialog title="Novo quadro" label="Nome do quadro" confirm="Criar" onClose={() => setDialog(null)}
          onSave={async (name) => { const b = await post<{ id: string }>('/boards', { name }); select(b.id); return b; }} />
      )}
      {dialog === 'import' && (
        <ImportTrelloDialog onClose={() => setDialog(null)}
          onImported={(id) => { select(id); setDialog(null); toast('Quadro importado do Trello.'); }} />
      )}
      {dialog === 'renameBoard' && board.data && (
        <NameDialog title="Renomear quadro" label="Nome do quadro" confirm="Salvar" initial={board.data.name} onClose={() => setDialog(null)}
          onSave={(name) => patch(`/boards/${board.data!.id}`, { name })} />
      )}
      {dialog === 'newList' && board.data && (
        <NameDialog title="Nova fase" label="Nome da fase" confirm="Criar" onClose={() => setDialog(null)}
          onSave={(name) => post(`/boards/${board.data!.id}/lists`, { name })} />
      )}
      {dialog === 'color' && board.data && <ColorDialog board={board.data} onClose={() => setDialog(null)} />}
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

const SORTS: { by: 'title' | 'created' | 'due'; label: string; done: string }[] = [
  { by: 'title', label: 'Ordenar por nome (A–Z)', done: 'por nome' },
  { by: 'created', label: 'Ordenar por data de criação', done: 'por data de criação' },
  { by: 'due', label: 'Ordenar por prazo', done: 'por prazo' },
];

type DropAt = { listId: string; beforeId: string | null } | null;

function Kanban({ board, today, onNewList }: { board: Board; today: string; onNewList: () => void }) {
  const { run, error } = useAction();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<DropAt>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);

  const cardsOf = (listId: string) => board.cards.filter((c) => c.listId === listId).sort((a, b) => a.position - b.position);

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
    run(() => post(`/cards/${id}/move`, { listId: target.listId, position }));
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

  const line = <div className="drop-line" aria-hidden="true" />;

  return (
    <div className={`board-area${board.color ? ` colored bc-${board.color}` : ''}`}>
      <ErrorText error={error} />
      <div className="kanban">
        {board.lists.map((l, i) => {
          const cards = cardsOf(l.id);
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
                <span className="n">{cards.length}</span>
                <Menu label={`Opções da fase ${l.name}`} items={[
                  ...SORTS.map((s) => ({ label: s.label, onClick: () => run(() => post(`/lists/${l.id}/sort`, { by: s.by }), `Fase “${l.name}” ordenada ${s.done}.`), disabled: cards.length < 2 })),
                  { label: 'Renomear fase', onClick: () => setRenaming({ id: l.id, name: l.name }) },
                  { label: 'Mover fase para a esquerda', onClick: () => moveList(i, -1), disabled: i === 0 },
                  { label: 'Mover fase para a direita', onClick: () => moveList(i, 1), disabled: i === board.lists.length - 1 },
                  { label: cards.length ? 'Arquivar fase (mova as tarefas antes)' : 'Arquivar fase', onClick: () => cards.length ? toast('Mova as tarefas desta fase antes de arquivá-la.', 'error') : setArchiving({ id: l.id, name: l.name }), danger: true },
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
              <AddCard listId={l.id} />
            </section>
          );
        })}
        <div className="add-col">
          <button className="add-card" style={{ margin: 0 }} onClick={onNewList}><Icon name="plus" />Nova fase</button>
        </div>
      </div>
      <p className="hint">Arraste as tarefas para mudar a ordem ou a fase; a linha azul mostra onde ela vai entrar. No celular, abra a tarefa e use “Mover para”.</p>

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
  const d = card.delegation;
  const done = !!card.completedAt;
  const canToggle = !d || d.status === 'IN_PROGRESS' || d.status === 'AWAITING_ACK';
  const toggle = () =>
    run(() => post(`/cards/${card.id}/${done ? 'uncomplete' : 'complete'}`),
      done ? 'Conclusão desfeita.' : d ? `Concluída. ${firstName(d.delegatorName)} foi avisado(a) para dar o ciente.` : 'Tarefa concluída.');
  const showStatus = d && (d.status === 'AWAITING_ACK' || d.reopened);
  return (
    <article className={`kc${done ? ' done' : ''}${dragging ? ' dragging' : ''}`} draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragOver={onDragOver} onDrop={onDrop}>
      <button className={`ck${done ? ' on' : ''}`} onClick={toggle} disabled={!canToggle} aria-label={done ? `Desfazer conclusão de ${card.title}` : `Concluir ${card.title}`}>
        {done && <Icon name="check" />}
      </button>
      <button className="t" onClick={() => go(`/tarefa/${card.code}`)} title={card.title}>{card.title}</button>
      <div className="meta">
        <span className="code">{card.code}</span>
        <Due date={card.dueDate} done={done} today={today} />
        {card.checklist.total > 0 && <span className="cl" title="Checklist"><Icon name="checks" />{card.checklist.done}/{card.checklist.total}</span>}
        {d && <TipIcon name="into" tip={`Delegada por ${d.delegatorName}`} />}
        {card.child && !['CANCELED'].includes(card.child.status) && <TipIcon name="out" tip={`Repassada para ${card.child.ownerName}`} />}
        {card.isPrivate && <TipIcon name="lock" tip="Privada: nenhum superior vê" />}
        {showStatus && <CardStatusIcon card={card} />}
      </div>
    </article>
  );
}

function AddCard({ listId }: { listId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const { run, error } = useAction();
  useEffect(() => { if (!open) setTitle(''); }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setOpen(false); return; }
    if (await run(() => post('/cards', { listId, title }))) setTitle('');
  };
  if (!open) return <button className="add-card" onClick={() => setOpen(true)}><Icon name="plus" />Adicionar tarefa</button>;
  return (
    <form className="add-form" onSubmit={submit}>
      <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título da tarefa" aria-label="Título da nova tarefa"
        maxLength={200} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="b pri sm" type="submit">Adicionar</button>
        <button className="b ghost sm" type="button" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}
