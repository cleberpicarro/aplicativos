import { describe, it, expect } from 'vitest';
import { sortPeople, notLate, type PersonLoad } from './dashboard';

const p = (name: string, onTime: number, dueSoon: number, late: number): PersonLoad =>
  ({ id: name, name, roleTitle: '', onTime, dueSoon, late, own: 0 });
const people = [p('Ana', 1, 0, 0), p('Bruno', 2, 1, 3), p('Carla', 4, 0, 1), p('Davi', 0, 0, 0)];
const names = (l: PersonLoad[]) => l.map((x) => x.name);

describe('ordenação das barras do Painel', () => {
  it('soma no prazo e vence em 7 dias na parte azul', () => {
    expect(notLate(people[1])).toBe(3);
  });
  it('pelo total, do maior para o menor e o contrário', () => {
    expect(names(sortPeople(people, 'total', 'desc'))).toEqual(['Bruno', 'Carla', 'Ana', 'Davi']);
    expect(names(sortPeople(people, 'total', 'asc'))).toEqual(['Davi', 'Ana', 'Carla', 'Bruno']);
  });
  it('pelas atrasadas', () => {
    expect(names(sortPeople(people, 'late', 'desc'))).toEqual(['Bruno', 'Carla', 'Ana', 'Davi']);
    expect(names(sortPeople(people, 'late', 'asc'))).toEqual(['Davi', 'Ana', 'Carla', 'Bruno']);
  });
  it('empate no total: quem tem mais atrasadas vem primeiro', () => {
    const tie = [p('X', 3, 0, 0), p('Y', 1, 0, 2)];
    expect(names(sortPeople(tie, 'total', 'desc'))).toEqual(['Y', 'X']);
  });
  it('não altera a lista original', () => {
    const copy = [...people];
    sortPeople(people, 'total', 'desc');
    expect(people).toEqual(copy);
  });
});
