export interface PersonLoad { id: string; name: string; roleTitle: string; onTime: number; dueSoon: number; late: number; own: number }

export type SortBy = 'total' | 'late';
export type SortDir = 'desc' | 'asc';

/** Delegadas abertas que não estão atrasadas (no prazo ou sem data). */
export const notLate = (p: PersonLoad) => p.onTime + p.dueSoon;
export const total = (p: PersonLoad) => notLate(p) + p.late;

/**
 * Ordena as barras do Painel pelo total ou pelas atrasadas.
 * Empate: mais atrasadas (ou maior total) primeiro, depois o nome, para a ordem não "pular".
 */
export function sortPeople(people: PersonLoad[], by: SortBy, dir: SortDir): PersonLoad[] {
  const key = by === 'total' ? total : (p: PersonLoad) => p.late;
  const tie = by === 'total' ? (p: PersonLoad) => p.late : total;
  const sign = dir === 'desc' ? -1 : 1;
  return [...people].sort((a, b) =>
    sign * (key(a) - key(b)) || sign * (tie(a) - tie(b)) || a.name.localeCompare(b.name, 'pt-BR'));
}
