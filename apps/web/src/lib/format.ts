import type { Card, DelegationStatus } from './api';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

export function shortDate(d: string): string {
  return `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
}

export function fullDate(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 86400 * 7) return `há ${Math.floor(diff / 86400)} d`;
  return dateTime(iso).slice(0, 8);
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('');
}

export function firstName(name: string): string {
  return name.split(' ')[0];
}

export type StatusKey = 'own' | 'inbox' | 'active' | 'reopened' | 'awaiting' | 'declined' | 'acked' | 'canceled' | 'done';

export const STATUS: Record<StatusKey, { label: string; tip: string; tone: '' | 'attn' }> = {
  own: { label: 'Em andamento', tip: 'Em andamento', tone: '' },
  inbox: { label: 'Aguardando aceite', tip: 'Aguardando aceite: está na caixa de entrada', tone: '' },
  active: { label: 'Em andamento', tip: 'Em andamento', tone: '' },
  reopened: { label: 'Reaberta', tip: 'Reaberta: devolvida para refazer', tone: '' },
  awaiting: { label: 'Concluída, aguardando ciente', tip: 'Concluída: aguardando o ciente de quem delegou', tone: 'attn' },
  declined: { label: 'Devolvida', tip: 'Devolvida com justificativa', tone: 'attn' },
  acked: { label: 'Arquivada', tip: 'Arquivada: ciente dado', tone: '' },
  canceled: { label: 'Cancelada', tip: 'Delegação cancelada', tone: '' },
  done: { label: 'Concluída', tip: 'Concluída', tone: '' },
};

export function statusOf(c: Card): StatusKey {
  if (c.delegation) return delegationKey(c.delegation.status, c.delegation.reopened);
  if (c.completedAt) return 'done';
  if (c.inInbox) return 'inbox';
  return 'own';
}

export function delegationKey(s: DelegationStatus, reopened: boolean): StatusKey {
  switch (s) {
    case 'PENDING_ACCEPT': return 'inbox';
    case 'IN_PROGRESS': return reopened ? 'reopened' : 'active';
    case 'AWAITING_ACK': return 'awaiting';
    case 'DECLINED': return 'declined';
    case 'ACKED': return 'acked';
    case 'CANCELED': return 'canceled';
  }
}

export function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}
