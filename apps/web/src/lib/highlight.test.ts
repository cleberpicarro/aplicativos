import { describe, it, expect } from 'vitest';
import { dueTone } from './format';

const T = '2026-11-13';
const c = (dueDate: string | null, extra: object = {}) => ({ dueDate, completedAt: null, archivedAt: null, child: null, ...extra });

describe('item 94: qual destaque cada tarefa recebe', () => {
  it('atrasada, hoje, futura e sem prazo', () => {
    expect(dueTone(c('2026-11-12'), T)).toBe(' hl-late');
    expect(dueTone(c(T), T)).toBe(' hl-today');
    expect(dueTone(c('2026-11-14'), T)).toBe('');
    expect(dueTone(c(null), T)).toBe('');
  });
  it('concluída, arquivada ou aguardando o seu ciente não é pintada; devolvida e em andamento são', () => {
    expect(dueTone(c('2026-11-01', { completedAt: '2026-11-02T10:00:00Z' }), T)).toBe('');
    expect(dueTone(c('2026-11-01', { archivedAt: '2026-11-02T10:00:00Z' }), T)).toBe('');
    expect(dueTone(c('2026-11-01', { child: { status: 'AWAITING_ACK' } }), T)).toBe('');
    expect(dueTone(c('2026-11-01', { child: { status: 'DECLINED' } }), T)).toBe(' hl-late');
    expect(dueTone(c(T, { child: { status: 'IN_PROGRESS' } }), T)).toBe(' hl-today');
  });
});
