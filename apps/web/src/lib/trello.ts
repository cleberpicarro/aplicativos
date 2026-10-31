/**
 * Lê o JSON exportado de um quadro do Trello (menu do quadro → Imprimir, exportar e compartilhar → Exportar como JSON)
 * ou o arquivo do "Exportar tarefas (JSON)" do SyncTasks (item 62: vários quadros no mesmo formato do Trello)
 * e monta o que será importado. Tudo acontece no navegador: só o necessário vai para o servidor.
 */

export interface ImportCard {
  title: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  isPrivate: boolean;
  color: string | null;
  members: string[];
  checklist: { text: string; done: boolean }[];
  comments: { author: string; date: string; text: string }[];
}

export interface TrelloImport {
  source: 'Trello' | 'SyncTasks';
  boardName: string;
  boardColor: string | null;
  lists: { name: string; cards: ImportCard[] }[];
}

export interface TrelloPreview {
  payload: TrelloImport;
  stats: {
    lists: number;
    cards: number;
    checklistItems: number;
    comments: number;
    completed: number;
    archivedLists: number;
    archivedCards: number;
    labels: number;
    attachments: number;
  };
}

interface TList { id: string; name?: string; closed?: boolean; pos?: number }
interface TCard {
  id: string; name?: string; desc?: string; due?: string | null; dueComplete?: boolean; closed?: boolean;
  idList: string; pos?: number; idMembers?: string[]; synctasks?: { privada?: boolean; cor?: string | null }; idLabels?: string[]; labels?: unknown[]; attachments?: unknown[]; badges?: { attachments?: number };
}
interface TChecklist { id: string; idCard: string; name?: string; pos?: number; checkItems?: { name?: string; state?: string; pos?: number }[] }
interface TMember { id: string; fullName?: string; username?: string }
interface TAction { type?: string; date?: string; data?: { text?: string; card?: { id?: string } }; memberCreator?: { fullName?: string; username?: string } }

// Cores do SyncTasks (as mesmas do servidor); outra qualquer é ignorada.
const COLORS = ['azul', 'verde', 'amarelo', 'laranja', 'vermelho', 'roxo', 'rosa', 'cinza'];
const color = (c: unknown) => (typeof c === 'string' && COLORS.includes(c) ? c : null);

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Data de entrega do Trello (ISO, UTC) → dia local AAAA-MM-DD. */
function localDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseTrello(raw: unknown, source: TrelloImport['source'] = 'Trello'): TrelloPreview {
  const data = raw as {
    name?: string; lists?: TList[]; cards?: TCard[]; checklists?: TChecklist[]; members?: TMember[]; actions?: TAction[];
    synctasks?: { cor?: string | null };
  };
  if (!data || typeof data !== 'object' || !Array.isArray(data.lists) || !Array.isArray(data.cards)) {
    throw new Error('Este arquivo não parece ser um quadro exportado do Trello. Use “Exportar como JSON” no menu do quadro.');
  }
  const members = new Map((data.members ?? []).map((m) => [m.id, m.fullName || m.username || '']));
  const checklists = new Map<string, TChecklist[]>();
  for (const cl of data.checklists ?? []) {
    if (!checklists.has(cl.idCard)) checklists.set(cl.idCard, []);
    checklists.get(cl.idCard)!.push(cl);
  }
  const comments = new Map<string, { author: string; date: string; text: string }[]>();
  for (const a of data.actions ?? []) {
    const cardId = a.data?.card?.id;
    if (a.type !== 'commentCard' || !cardId || !a.data?.text) continue;
    if (!comments.has(cardId)) comments.set(cardId, []);
    comments.get(cardId)!.push({ author: a.memberCreator?.fullName || a.memberCreator?.username || '', date: a.date ?? '', text: cut(a.data.text, 5000) });
  }

  const byPos = <T extends { pos?: number }>(a: T, b: T) => (a.pos ?? 0) - (b.pos ?? 0);
  const activeLists = data.lists.filter((l) => !l.closed).sort(byPos);
  const activeIds = new Set(activeLists.map((l) => l.id));
  const stats = { lists: activeLists.length, cards: 0, checklistItems: 0, comments: 0, completed: 0, archivedLists: data.lists.length - activeLists.length, archivedCards: 0, labels: 0, attachments: 0 };

  const lists = activeLists.map((l) => {
    const cards = data.cards!
      .filter((c) => c.idList === l.id)
      .filter((c) => {
        if (c.closed) stats.archivedCards++;
        return !c.closed;
      })
      .sort(byPos)
      .map((c): ImportCard => {
        const items = (checklists.get(c.id) ?? []).sort(byPos);
        const many = items.length > 1;
        const checklist = items.flatMap((cl) =>
          (cl.checkItems ?? [])
            .slice()
            .sort(byPos)
            .filter((it) => it.name?.trim())
            .map((it) => ({ text: cut(`${many && cl.name ? `${cl.name}: ` : ''}${it.name!.trim()}`, 300), done: it.state === 'complete' })),
        ).slice(0, 300);
        const cmts = (comments.get(c.id) ?? []).sort((a, b) => a.date.localeCompare(b.date)).slice(-500);
        stats.cards++;
        stats.checklistItems += checklist.length;
        stats.comments += cmts.length;
        if (c.dueComplete) stats.completed++;
        stats.labels += (c.idLabels ?? c.labels ?? []).length;
        stats.attachments += c.attachments?.length ?? c.badges?.attachments ?? 0;
        return {
          title: cut((c.name ?? '').trim() || 'Sem título', 200),
          description: cut(c.desc ?? '', 20000),
          dueDate: localDate(c.due),
          completed: !!c.dueComplete,
          isPrivate: c.synctasks?.privada === true,
          color: color(c.synctasks?.cor),
          members: (c.idMembers ?? []).map((id) => members.get(id) ?? '').filter(Boolean),
          checklist,
          comments: cmts,
        };
      });
    return { name: cut((l.name ?? '').trim() || 'Sem nome', 60), cards };
  });
  // Cartões de listas arquivadas também ficam de fora.
  stats.archivedCards += data.cards.filter((c) => !activeIds.has(c.idList)).length;

  if (!lists.length) throw new Error('O quadro não tem listas ativas para importar.');
  return {
    payload: { source, boardName: cut((data.name ?? '').trim() || 'Quadro do Trello', 80), boardColor: color(data.synctasks?.cor), lists },
    stats,
  };
}

/** Item 62: arquivo do "Exportar tarefas (JSON)" do SyncTasks. */
export const EXPORT_FORMAT = 'synctasks-exportacao';

export interface ImportFile {
  kind: 'trello' | 'synctasks';
  /** Quadros que dá para importar (no arquivo do Trello, sempre um). */
  boards: TrelloPreview[];
  /** Arquivo do SyncTasks: quadros arquivados ou sem fases ativas, que ficam de fora. */
  skippedBoards: number;
}

/** Reconhece o arquivo (Trello ou SyncTasks) e monta a prévia de cada quadro. */
export function parseImportFile(raw: unknown): ImportFile {
  const data = raw as { formato?: string; quadros?: unknown[] };
  if (!data || typeof data !== 'object' || data.formato !== EXPORT_FORMAT) return { kind: 'trello', boards: [parseTrello(raw)], skippedBoards: 0 };
  if (!Array.isArray(data.quadros)) throw new Error('Este arquivo do SyncTasks está incompleto. Exporte as tarefas de novo.');
  const boards: TrelloPreview[] = [];
  let skippedBoards = 0;
  for (const q of data.quadros as { closed?: boolean }[]) {
    if (!q || q.closed) { skippedBoards++; continue; }
    try {
      boards.push(parseTrello(q, 'SyncTasks'));
    } catch {
      skippedBoards++;
    }
  }
  if (!boards.length) throw new Error('O arquivo não tem quadros ativos para importar.');
  return { kind: 'synctasks', boards, skippedBoards };
}
