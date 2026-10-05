export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'X-SyncTasks': '1' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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
  code: string;
  title: string;
  description: string;
  dueDate: string | null;
  isPrivate: boolean;
  completedAt: string | null;
  archivedAt: string | null;
  ownerId: string;
  ownerName: string;
  boardId: string | null;
  listId: string | null;
  position: number;
  inInbox: boolean;
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
  };
  child: null | { delegationId: string; cardId: string; code: string; ownerName: string; status: DelegationStatus; reopened: boolean };
  checklist: { done: number; total: number };
  source: 'web' | 'email' | 'trello' | null;
  createdAt: string;
}

export interface Me {
  user: { id: string; name: string; email: string; level: number | null; roleTitle: string; managerId: string | null; isAdmin: boolean; inHierarchy: boolean };
  directReports: { id: string; name: string; roleTitle: string }[];
  counts: { inbox: number; needAction: number; unread: number };
  today: string;
}

export interface CardDetail {
  card: Card;
  role: 'owner' | 'delegator' | 'auditor';
  canSeeLog: boolean;
  board: null | { id: string; name: string; lists: { id: string; name: string }[] };
  checklistItems: { id: string; text: string; done: boolean }[];
  comments: { id: string; body: string; createdAt: string; authorId: string; authorName: string }[];
}

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
