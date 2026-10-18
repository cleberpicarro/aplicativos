import type { QueryClient } from '@tanstack/react-query';
import type { Board, Card, CardDetail } from './api';

/*
 * Item 54: a tela responde na hora. A mudança aparece primeiro nos dados guardados na memória (quadros e tarefa
 * aberta); o servidor grava por trás. Se o servidor recusar, quem chamou usa o "desfazer" devolvido aqui.
 */

type Saved = [readonly unknown[], unknown][];
const restore = (qc: QueryClient, saved: Saved) => () => { for (const [k, d] of saved) qc.setQueryData(k, d); };

/** Muda (ou tira, com null) a tarefa em todos os quadros e na tarefa aberta. Devolve como voltar ao que era. */
export function changeCard(qc: QueryClient, id: string, change: Partial<Card> | null): () => void {
  const saved: Saved = [];
  for (const [key, data] of qc.getQueriesData<Board>({ queryKey: ['board'] })) {
    if (!data?.cards?.some((c) => c.id === id)) continue;
    saved.push([key, data]);
    const cards = change ? data.cards.map((c) => (c.id === id ? { ...c, ...change } : c)) : data.cards.filter((c) => c.id !== id);
    qc.setQueryData(key, { ...data, cards });
  }
  if (change) {
    for (const [key, data] of qc.getQueriesData<CardDetail>({ queryKey: ['card'] })) {
      if (data?.card?.id !== id) continue;
      saved.push([key, data]);
      qc.setQueryData(key, { ...data, card: { ...data.card, ...change } });
    }
  }
  return restore(qc, saved);
}

/** Marca ou desmarca um item do checklist na tarefa aberta e atualiza a contagem no cartão do quadro. */
export function changeChecklistItem(qc: QueryClient, cardId: string, itemId: string, done: boolean): () => void {
  const saved: Saved = [];
  let delta = 0;
  for (const [key, data] of qc.getQueriesData<CardDetail>({ queryKey: ['card'] })) {
    if (data?.card?.id !== cardId) continue;
    const item = data.checklistItems.find((i) => i.id === itemId);
    if (!item || item.done === done) continue;
    delta = done ? 1 : -1;
    saved.push([key, data]);
    qc.setQueryData(key, { ...data, checklistItems: data.checklistItems.map((i) => (i.id === itemId ? { ...i, done } : i)) });
  }
  const undo = restore(qc, saved);
  if (!delta) return undo;
  for (const [, data] of qc.getQueriesData<Board>({ queryKey: ['board'] })) {
    const c = data?.cards?.find((x) => x.id === cardId);
    if (c) { const undoBoard = changeCard(qc, cardId, { checklist: { ...c.checklist, done: c.checklist.done + delta } }); return () => { undoBoard(); undo(); }; }
  }
  return undo;
}

/** Põe um cartão provisório no fim da fase enquanto o servidor cria a tarefa. */
export function addPendingCard(qc: QueryClient, listId: string, title: string): () => void {
  const saved: Saved = [];
  for (const [key, data] of qc.getQueriesData<Board>({ queryKey: ['board'] })) {
    if (!data?.lists?.some((l) => l.id === listId)) continue;
    saved.push([key, data]);
    const last = Math.max(0, ...data.cards.filter((c) => c.listId === listId).map((c) => c.position));
    const now = new Date().toISOString();
    const card: Card = {
      id: `novo-${Math.random().toString(36).slice(2)}`, code: '', num: 0, color: null, title, description: '', dueDate: null, isPrivate: false,
      completedAt: null, archivedAt: null, ownerId: '', ownerName: '', boardId: data.id, boardName: data.name, listId, position: last + 1,
      inInbox: false, discarded: false, transferredFrom: null, delegation: null, child: null, checklist: { done: 0, total: 0 }, source: null, createdAt: now,
    };
    qc.setQueryData(key, { ...data, cards: [...data.cards, card] });
  }
  return restore(qc, saved);
}

/** A tarefa como aparece no quadro guardado na memória (para abrir a janela na hora, item 55). */
export function cardFromBoards(qc: QueryClient, idOrCode: string): Card | undefined {
  for (const [, data] of qc.getQueriesData<Board>({ queryKey: ['board'] })) {
    const c = data?.cards?.find((x) => x.id === idOrCode || x.code === idOrCode);
    if (c) return c;
  }
  return undefined;
}

export const isPending = (c: Card) => c.id.startsWith('novo-');
