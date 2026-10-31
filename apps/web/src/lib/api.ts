export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Item 72: no seletor do topo, quem substitui alguém troca para essa pessoa. A escolha vale para esta aba
 * (sessionStorage) e vai em todo pedido no cabeçalho X-SyncTasks-Como.
 */
const ACTING_KEY = 'synctasks.substituindo';
let acting: string | null = (() => {
  try { return sessionStorage.getItem(ACTING_KEY); } catch { return null; }
})();
export const actingAs = () => acting;
/** Troca de pessoa: recarrega a página, para nenhuma tela mostrar dados da pessoa anterior. */
export function setActingAs(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ACTING_KEY, id);
    else sessionStorage.removeItem(ACTING_KEY);
  } catch { /* sem armazenamento: vale até recarregar */ }
  acting = id;
  window.location.hash = '#/quadros';
  window.location.reload();
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-SyncTasks': '1',
      ...(acting ? { 'X-SyncTasks-Como': acting } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  // A substituição acabou (encerrada ou passou do último dia): volta para as próprias tarefas.
  if (acting && res.status === 403 && data?.error === 'A substituição terminou.') setActingAs(null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Não foi possível concluir a ação.');
  return data as T;
}

export const get = <T = any>(url: string) => api<T>('GET', url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T = any>(url: string, body: unknown) => api<T>('PATCH', url, body);
export const del = <T = any>(url: string) => api<T>('DELETE', url);

export type DelegationStatus = 'PENDING_ACCEPT' | 'IN_PROGRESS' | 'AWAITING_ACK' | 'DECLINED' | 'ACKED' | 'CANCELED';

export interface Card {
  id: string;
  /** Código único antigo (ST-000123): só por dentro, para links e códigos antigos. */
  code: string;
  /** Item 37: número da tarefa no quadro (ou na caixa de entrada); aparece como #12. */
  num: number;
  /** Item 38: cor do cartão, escolhida por quem tem a tarefa. */
  color: string | null;
  title: string;
  description: string;
  dueDate: string | null;
  isPrivate: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  ownerId: string;
  ownerName: string;
  boardId: string | null;
  boardName: string | null;
  listId: string | null;
  position: number;
  inInbox: boolean;
  /** Item 50: descartada da caixa de entrada (arquivada sem concluir); desarquivar devolve à caixa. */
  discarded: boolean;
  transferredFrom: { id: string; name: string } | null;
  delegation: null | {
    id: string;
    status: DelegationStatus;
    reopened: boolean;
    delegatorId: string;
    delegatorName: string;
    suggestedDue: string | null;
    declineReason: string | null;
    parentCode: string | null;
    parentNum: number | null;
    /** Item 41: o delegador pediu que a própria pessoa faça a tarefa. */
    noPass: boolean;
  };
  child: null | { delegationId: string; cardId: string; code: string; num: number; ownerName: string; status: DelegationStatus; reopened: boolean; noPass: boolean };
  checklist: { done: number; total: number };
  source: 'web' | 'email' | 'trello' | 'arquivo' | 'assistente' | null;
  createdAt: string;
}

export interface Me {
  user: { id: string; name: string; email: string; level: number | null; roleTitle: string; managerId: string | null; isAdmin: boolean; inHierarchy: boolean };
  directReports: { id: string; name: string; roleTitle: string }[];
  counts: { inbox: number; needAction: number; unread: number };
  /** Item 80: tarefas delegadas ou transferidas que chegaram e ainda não apareceram como balão. */
  fresh?: { id: string; text: string; cardId: string | null }[];
  /** Item 46: resumo diário e avisos de prazo por e-mail (ligados por padrão). */
  prefs: { workspaceBg: string | null; emailDigest: boolean; emailDue: boolean; hideInactive: boolean };
  today: string;
  /** Item 72: quem a pessoa substitui (seletor do topo), em nome de quem está agindo agora e quem a substitui. */
  substitution: {
    covering: { id: string; name: string; roleTitle: string; shareCommon: boolean; endsOn: string | null }[];
    acting: null | { id: string; name: string; shareCommon: boolean; by: { id: string; name: string } };
    mine: Substitution | null;
  };
}

export interface Substitution {
  id: string;
  substitute: { id: string; name: string; roleTitle: string };
  shareCommon: boolean;
  endsOn: string | null;
  createdAt: string;
  createdByName: string;
}

export interface CardDetail {
  card: Card;
  role: 'owner' | 'delegator' | 'auditor';
  canSeeLog: boolean;
  board: null | { id: string; name: string; lists: { id: string; name: string }[] };
  checklistItems: { id: string; text: string; done: boolean }[];
  comments: { id: string; body: string; createdAt: string; authorId: string; authorName: string; viaName: string | null }[];
  /** Item 79: quem criou a tarefa de origem e quando ela foi delegada por último (só chega com a tarefa completa). */
  origin?: { creatorId: string; creatorName: string; createdAt: string; delegatedAt: string | null };
  /** Item 81: e-mails que seguem a tarefa. */
  followers?: Follower[];
}

export interface Follower { email: string; addedByName: string; createdAt: string }

export interface Board {
  id: string;
  name: string;
  color: string | null;
  lists: { id: string; name: string; position: number }[];
  cards: Card[];
}

export interface Overview {
  today: string;
  needAction: Card[];
  groups: {
    person: { id: string; name: string; roleTitle: string; direct: boolean };
    counts: { open: number; late: number; awaitingAck: number; declined: number; own: number };
    tasks: Card[];
  }[];
}
